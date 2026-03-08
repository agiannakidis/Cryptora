
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, query } = require('../pgdb');
const { authMiddleware: authenticate } = require("../middleware/auth");
const { v4: uuidv4 } = require('uuid');

// ── GET /api/deposit-wallets  (public — player sees deposit addresses)
router.get('/', async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT chain, token, label, address FROM deposit_wallet_settings
       WHERE is_active = true AND address != '' ORDER BY chain, token`
    );
    res.json(rows);
  } catch (e) {
    console.error('[deposit-wallets GET]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/deposit-wallets/admin  (admin — all including empty)
router.get('/admin', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const rows = await queryAll(
      `SELECT * FROM deposit_wallet_settings ORDER BY chain, token`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/deposit-wallets/admin/:id  (admin sets address)
router.put('/admin/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { address, label, is_active } = req.body;
    const row = await queryOne(
      `UPDATE deposit_wallet_settings
       SET address = COALESCE($1, address),
           label = COALESCE($2, label),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [address ?? null, label ?? null, is_active ?? null, req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    console.error('[deposit-wallets PUT]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/deposit-wallets/verify-tx  (player submits tx hash)
// Verifies the TX on-chain and credits the player
router.post('/verify-tx', authenticate, async (req, res) => {
  const { tx_hash, chain, token } = req.body;
  if (!tx_hash || !chain || !token) {
    return res.status(400).json({ error: 'tx_hash, chain, token required' });
  }

  const userId = req.user.id;
  const userEmail = req.user.email;

  try {
    // Idempotency check
    const exists = await queryOne(
      `SELECT id FROM tx_idempotency WHERE reference = $1`,
      [`deposit_${tx_hash.toLowerCase()}`]
    );
    if (exists) return res.status(409).json({ error: 'Transaction already processed' });

    // Get expected admin wallet address
    const wallet = await queryOne(
      `SELECT address FROM deposit_wallet_settings WHERE chain = $1 AND token = $2 AND is_active = true`,
      [chain, token]
    );
    if (!wallet || !wallet.address) {
      return res.status(400).json({ error: 'This chain/token is not configured for deposits' });
    }
    const expectedAddress = wallet.address.toLowerCase();

    // Verify on blockchain
    let amountCrypto = 0;
    let verified = false;

    if (chain === 'TRX') {
      const result = await verifyTronTx(tx_hash, token, expectedAddress);
      amountCrypto = result.amount;
      verified = result.verified;
    } else if (chain === 'ETH' || chain === 'BSC' || chain === 'POLYGON' || chain === 'ARBITRUM') {
      const result = await verifyEvmTx(tx_hash, token, expectedAddress, chain);
      amountCrypto = result.amount;
      verified = result.verified;
    } else if (chain === 'BTC') {
      const result = await verifyBtcTx(tx_hash, expectedAddress);
      amountCrypto = result.amount;
      verified = result.verified;
    } else if (chain === 'TON') {
      const result = await verifyTonTx(tx_hash, expectedAddress);
      amountCrypto = result.amount;
      verified = result.verified;
    } else if (chain === 'XRP') {
      const result = await verifyXrpTx(tx_hash, expectedAddress);
      amountCrypto = result.amount;
      verified = result.verified;
    } else {
      return res.status(400).json({ error: 'Unsupported chain' });
    }

    if (!verified || amountCrypto <= 0) {
      return res.status(400).json({ error: 'Transaction not verified or zero amount. Check TX hash and chain.' });
    }

    // Get USD price
    const prices = await getPrices();
    const priceKey = (token === 'USDT' || token === 'USDC') ? token :
                     chain === 'TRX' ? 'TRX' :
                     chain === 'ETH' ? 'ETH' :
                     chain === 'BTC' ? 'BTC' :
                     chain === 'TON' ? 'TON' : token;
    const amountUsd = amountCrypto * (prices[priceKey] || 0);

    if (amountUsd < 0.5) {
      return res.status(400).json({ error: `Amount too small: $${amountUsd.toFixed(2)}` });
    }

    // Credit player
    await query('BEGIN');
    try {
      // Record idempotency
      await query(
        `INSERT INTO tx_idempotency (reference, created_at) VALUES ($1, NOW())`,
        [`deposit_${tx_hash.toLowerCase()}`]
      );

      // Credit balance
      await query(
        `UPDATE users SET balance = balance + $1 WHERE id = $2`,
        [amountUsd, userId]
      );

      // Record in ClickHouse
      const { insert: chInsert } = require('../chdb');
      const now = new Date().toISOString().replace('T', ' ').slice(0, 23);
      await chInsert('crypto_deposits', [{
        id: uuidv4(),
        user_id: userId,
        chain, token,
        amount_crypto: amountCrypto,
        amount_usd: amountUsd,
        tx_hash: tx_hash.toLowerCase(),
        confirmations: 1,
        status: 'confirmed',
        credited: 1,
        created_at: now,
        confirmed_at: now,
      }]).catch(e => console.error('[CH deposit]', e.message));

      // Record PG transaction
      await query(
        `INSERT INTO crypto_addresses (user_id, chain, token, address, created_date)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [userId, chain, token, wallet.address]
      );

      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }

    const newUser = await queryOne('SELECT balance FROM users WHERE id = $1', [userId]);
    console.log(`[deposit-verify] User ${userEmail} deposited $${amountUsd.toFixed(2)} via ${chain}/${token} tx:${tx_hash}`);

    res.json({
      ok: true,
      amount_crypto: amountCrypto,
      amount_usd: amountUsd,
      new_balance: parseFloat(newUser.balance),
      message: `+$${amountUsd.toFixed(2)} credited to your balance`
    });

  } catch (e) {
    console.error('[verify-tx]', e.message);
    res.status(500).json({ error: 'Verification failed: ' + e.message });
  }
});

// ── Blockchain verifiers ─────────────────────────────────────────────────────

async function verifyTronTx(txHash, token, expectedAddress) {
  try {
    const r = await fetch(`https://api.trongrid.io/v1/transactions/${txHash}`);
    const data = await r.json();
    const tx = data?.data?.[0];
    if (!tx || tx.ret?.[0]?.contractRet !== 'SUCCESS') return { verified: false, amount: 0 };

    if (token === 'TRX') {
      // Native TRX transfer
      const contract = tx.raw_data?.contract?.[0];
      if (contract?.type !== 'TransferContract') return { verified: false, amount: 0 };
      const toAddr = contract?.parameter?.value?.to_address;
      const toHex = toAddr?.startsWith('41') ? tronHexToBase58(toAddr) : toAddr;
      if (!toHex?.toLowerCase().includes(expectedAddress.replace('T', '').toLowerCase().slice(-10))) return { verified: false, amount: 0 };
      const amount = (contract?.parameter?.value?.amount || 0) / 1e6;
      return { verified: true, amount };
    } else {
      // TRC20 token transfer
      const logs = tx.log || [];
      for (const log of logs) {
        const toAddr = '41' + log.topics?.[2]?.slice(-40);
        const toBase58 = tronHexToBase58(toAddr);
        if (toBase58?.toLowerCase() === expectedAddress.toLowerCase()) {
          const amount = parseInt(log.data, 16) / 1e6; // USDT/USDC decimals=6
          return { verified: true, amount };
        }
      }
      return { verified: false, amount: 0 };
    }
  } catch (e) {
    console.error('[verifyTronTx]', e.message);
    return { verified: false, amount: 0 };
  }
}

function tronHexToBase58(hex) {
  try {
    const { TronWeb } = require('tronweb');
    return TronWeb.address.fromHex(hex);
  } catch {
    return null;
  }
}

async function verifyBtcTx(txHash, expectedAddress) {
  try {
    const r = await fetch(`https://mempool.space/api/tx/${txHash}`);
    if (!r.ok) return { verified: false, amount: 0 };
    const tx = await r.json();
    if (!tx.status?.confirmed && !tx.status) return { verified: false, amount: 0 };
    let amount = 0;
    for (const vout of (tx.vout || [])) {
      if (vout.scriptpubkey_address?.toLowerCase() === expectedAddress.toLowerCase()) {
        amount += vout.value / 1e8;
      }
    }
    return { verified: amount > 0, amount };
  } catch (e) {
    return { verified: false, amount: 0 };
  }
}

async function verifyEvmTx(txHash, token, expectedAddress, chain) {
  try {
    // Use public RPC
    const rpcMap = {
      ETH: 'https://eth.llamarpc.com',
      POLYGON: 'https://polygon.llamarpc.com',
      BSC: 'https://bsc.llamarpc.com',
      ARBITRUM: 'https://arbitrum.llamarpc.com',
    };
    const rpc = rpcMap[chain] || 'https://eth.llamarpc.com';
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] })
    });
    const data = await r.json();
    const receipt = data?.result;
    if (!receipt || receipt.status !== '0x1') return { verified: false, amount: 0 };

    if (token === 'ETH' || token === 'BNB' || token === 'MATIC') {
      // Native transfer — check value
      const txR = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getTransactionByHash', params: [txHash] })
      });
      const txData = await txR.json();
      const tx = txData?.result;
      if (tx?.to?.toLowerCase() !== expectedAddress.toLowerCase()) return { verified: false, amount: 0 };
      const amount = parseInt(tx.value, 16) / 1e18;
      return { verified: true, amount };
    } else {
      // ERC20 Transfer event: Transfer(address,address,uint256)
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      for (const log of (receipt.logs || [])) {
        if (log.topics?.[0] !== transferTopic) continue;
        const to = '0x' + log.topics?.[2]?.slice(-40);
        if (to?.toLowerCase() === expectedAddress.toLowerCase()) {
          const amount = parseInt(log.data, 16) / 1e6; // USDT decimals=6
          return { verified: true, amount };
        }
      }
      return { verified: false, amount: 0 };
    }
  } catch (e) {
    console.error('[verifyEvmTx]', e.message);
    return { verified: false, amount: 0 };
  }
}

async function verifyTonTx(txHash, expectedAddress) {
  try {
    const r = await fetch(`https://toncenter.com/api/v2/getTransaction?transaction_id=${txHash}`);
    const data = await r.json();
    if (!data?.ok) return { verified: false, amount: 0 };
    const tx = data.result;
    const toAddr = tx?.in_msg?.destination;
    if (toAddr?.toLowerCase() !== expectedAddress.toLowerCase()) return { verified: false, amount: 0 };
    const amount = (tx?.in_msg?.value || 0) / 1e9;
    return { verified: amount > 0, amount };
  } catch (e) {
    return { verified: false, amount: 0 };
  }
}

async function verifyXrpTx(txHash, expectedAddress) {
  try {
    const r = await fetch('https://xrplcluster.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tx', params: [{ transaction: txHash }] })
    });
    const data = await r.json();
    const tx = data?.result;
    if (tx?.meta?.TransactionResult !== 'tesSUCCESS') return { verified: false, amount: 0 };
    if (tx?.Destination?.toLowerCase() !== expectedAddress.toLowerCase()) return { verified: false, amount: 0 };
    const amount = (tx?.Amount || 0) / 1e6;
    return { verified: amount > 0, amount };
  } catch (e) {
    return { verified: false, amount: 0 };
  }
}

async function getPrices() {
  try {
    const { getPrices: monitorPrices } = require('../crypto/monitor');
    return await monitorPrices();
  } catch {
    return { USDT: 1, USDC: 1, TRX: 0.28, ETH: 2000, BTC: 70000, TON: 1.3, XRP: 1.4 };
  }
}

module.exports = router;
