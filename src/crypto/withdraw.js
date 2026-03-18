const { queryOne, query } = require('../pgdb');
const { CHAINS } = require('./config');
const evmChain = require('./chains/evm');
const btcChain = require('./chains/bitcoin');
const tronChain = require('./chains/tron');
const tonChain = require('./chains/ton');
const solanaChain = require('./chains/solana');
const xrpChain = require('./chains/xrp');

// Get hot wallet private key for a given chain
function getHotWalletKey(chain) {
  const chainConfig = CHAINS[chain];
  if (!chainConfig) throw new Error('Unknown chain: ' + chain);

  if (chainConfig.type === 'evm') {
    const key = process.env.HOT_WALLET_EVM_KEY;
    if (!key) throw new Error('HOT_WALLET_EVM_KEY not configured');
    return key;
  }
  if (chain === 'TRX') {
    const key = process.env.HOT_WALLET_TRX_KEY;
    if (!key) throw new Error('HOT_WALLET_TRX_KEY not configured');
    return key;
  }
  if (chain === 'BTC' || chain === 'LTC') {
    const key = process.env.HOT_WALLET_BTC_KEY;
    if (!key) throw new Error('HOT_WALLET_BTC_KEY not configured');
    return key;
  }
  if (chain === 'SOL') {
    const key = process.env.HOT_WALLET_SOL_KEY;
    if (!key) throw new Error('HOT_WALLET_SOL_KEY not configured');
    return key;
  }
  if (chain === 'XRP') {
    const key = process.env.HOT_WALLET_XRP_KEY;
    if (!key) throw new Error('HOT_WALLET_XRP_KEY not configured');
    return key;
  }
  throw new Error('Hot wallet not configured for chain: ' + chain);
}

function getHotWalletAddress(chain) {
  const chainConfig = CHAINS[chain];
  if (chainConfig.type === 'evm') return process.env.HOT_WALLET_EVM_ADDRESS;
  if (chain === 'TRX') return process.env.HOT_WALLET_TRX_ADDRESS;
  if (chain === 'BTC' || chain === 'LTC') return process.env.HOT_WALLET_BTC_ADDRESS;
  return null;
}

async function processWithdrawal(withdrawalId) {
  const wd = await queryOne('SELECT * FROM crypto_withdrawals WHERE id = $1', [withdrawalId]);
  if (!wd || !['pending', 'processing'].includes(wd.status)) return null;

  const { chain, token, amount_crypto, to_address } = wd;
  const chainConfig = CHAINS[chain];
  if (!chainConfig) throw new Error('Unknown chain: ' + chain);

  const amount = parseFloat(amount_crypto);
  let result;

  try {
    // Always send from HOT WALLET, not user's HD wallet
    const privateKey = getHotWalletKey(chain);
    const hotAddress = getHotWalletAddress(chain);

    if (chainConfig.type === 'evm') {
      if (token === chainConfig.symbol) {
        result = await evmChain.sendNative(chain, privateKey, to_address, amount);
      } else {
        const contractAddress = chainConfig.tokenContracts?.[token];
        if (!contractAddress) throw new Error('No contract for ' + token + ' on ' + chain);
        result = await evmChain.sendToken(chain, privateKey, to_address, amount, contractAddress, 6);
      }
    } else if (chain === 'BTC') {
      const amountSats = Math.floor(amount * 1e8);
      result = await btcChain.sendBTC(privateKey, hotAddress, to_address, amountSats, 'BTC');
    } else if (chain === 'LTC') {
      const amountSats = Math.floor(amount * 1e8);
      result = await btcChain.sendBTC(privateKey, hotAddress, to_address, amountSats, 'LTC');
    } else if (chain === 'TRX') {
      if (token === 'TRX') {
        result = await tronChain.sendTRX(privateKey, to_address, amount);
      } else {
        const contractAddress = chainConfig.tokenContracts?.[token];
        if (!contractAddress) throw new Error('No contract for ' + token + ' on ' + chain);
        result = await tronChain.sendTRC20(privateKey, to_address, amount, contractAddress);
      }
    } else if (chain === 'TON') {
      result = await tonChain.sendTON(privateKey, to_address, amount);
    } else if (chain === 'SOL') {
      result = await solanaChain.sendSOL(privateKey, to_address, amount);
    } else if (chain === 'XRP') {
      result = await xrpChain.sendXRP(privateKey, to_address, amount);
    } else {
      throw new Error('Withdrawal not implemented for ' + chain);
    }

    await query(
      "UPDATE crypto_withdrawals SET status = 'completed', tx_hash = $1, processed_date = NOW() WHERE id = $2",
      [result.txHash, withdrawalId]
    );
    console.log('[Withdrawal] Done: ' + amount + ' ' + token + '@' + chain + ' → ' + to_address + ' tx=' + result.txHash);
    return result;

  } catch (e) {
    await query(
      "UPDATE crypto_withdrawals SET status = 'failed', error = $1 WHERE id = $2",
      [e.message, withdrawalId]
    );
    // Refund balance to user on failure
    try {
      const wd = await queryOne('SELECT user_id, amount_usd FROM crypto_withdrawals WHERE id = $1', [withdrawalId]);
      if (wd && wd.user_id && parseFloat(wd.amount_usd) > 0) {
        await query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [parseFloat(wd.amount_usd), wd.user_id]
        );
        console.log('[Withdrawal] Refunded $' + wd.amount_usd + ' to user ' + wd.user_id + ' after failure');
        // Record refund transaction
        const { v4: uuidv4 } = require('uuid');
        await query(
          `INSERT INTO tx_idempotency (id, reference, user_email, type, amount, balance_after, description)
           SELECT $1, $2, email, 'refund', $3, balance, $4
           FROM users WHERE id = $5`,
          [uuidv4(), 'refund_' + withdrawalId, parseFloat(wd.amount_usd),
           'Withdrawal failed — funds returned', wd.user_id]
        );
      }
    } catch(refundErr) {
      console.error('[Withdrawal] REFUND FAILED for ' + withdrawalId + ': ' + refundErr.message);
    }
    console.error('[Withdrawal] Failed ' + withdrawalId + ': ' + e.message);
    throw e;
  }
}

module.exports = { processWithdrawal };
