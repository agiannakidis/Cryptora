const {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Keypair,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const { CHAINS } = require('../config');

let _connection = null;

function getConnection() {
  if (!_connection) {
    _connection = new Connection(CHAINS.SOL.rpc, 'confirmed');
  }
  return _connection;
}

async function getSOLBalance(address) {
  const conn = getConnection();
  try {
    const pubkey = new PublicKey(address);
    const balance = await conn.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch (e) {
    return 0;
  }
}

async function getIncomingTransactions(address, limit = 20) {
  const conn = getConnection();
  const pubkey = new PublicKey(address);

  const signatures = await conn.getSignaturesForAddress(pubkey, { limit });
  const incoming = [];

  for (const sig of signatures) {
    if (sig.err) continue;
    try {
      const tx = await conn.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta) continue;

      const accountKeys = tx.transaction.message.staticAccountKeys ||
        tx.transaction.message.accountKeys;

      const addrIndex = accountKeys.findIndex(a => a.toString() === address);
      if (addrIndex < 0) continue;

      const pre = tx.meta.preBalances[addrIndex] || 0;
      const post = tx.meta.postBalances[addrIndex] || 0;
      const diff = (post - pre) / LAMPORTS_PER_SOL;

      if (diff > 0) {
        incoming.push({
          txHash: sig.signature,
          amount: diff,
          confirmed: true,
          slot: sig.slot,
        });
      }
    } catch (e) {
      // skip individual tx errors
    }
  }

  return incoming;
}

async function sendSOL(privateKeyHex, toAddress, amount) {
  const conn = getConnection();
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const keypair = Keypair.fromSecretKey(secretKey);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Math.floor(amount * LAMPORTS_PER_SOL),
    })
  );

  const signature = await sendAndConfirmTransaction(conn, transaction, [keypair]);
  return { txHash: signature };
}

module.exports = { getSOLBalance, getIncomingTransactions, sendSOL };
