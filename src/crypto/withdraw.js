const { queryOne, query } = require('../pgdb');
const { CHAINS } = require('./config');
const { getPrivateKey } = require('./wallet');
const evmChain = require('./chains/evm');
const btcChain = require('./chains/bitcoin');
const tronChain = require('./chains/tron');
const tonChain = require('./chains/ton');
const solanaChain = require('./chains/solana');
const xrpChain = require('./chains/xrp');

async function processWithdrawal(withdrawalId) {
  const wd = await queryOne('SELECT * FROM crypto_withdrawals WHERE id = $1', [withdrawalId]);
  if (!wd || wd.status !== 'pending') return null;

  const { user_id, chain, token, amount_crypto, to_address } = wd;
  const chainConfig = CHAINS[chain];
  if (!chainConfig) throw new Error('Unknown chain: ' + chain);

  let result;
  const amount = parseFloat(amount_crypto);

  try {
    const privateKey = await getPrivateKey(user_id, chain, token);

    if (chainConfig.type === 'evm') {
      if (token === chainConfig.symbol) {
        result = await evmChain.sendNative(chain, privateKey, to_address, amount);
      } else {
        const contractAddress = chainConfig.tokenContracts?.[token];
        if (!contractAddress) throw new Error('No contract for ' + token + ' on ' + chain);
        result = await evmChain.sendToken(chain, privateKey, to_address, amount, contractAddress, 6);
      }
    } else if (chain === 'BTC') {
      const addrRow = await queryOne('SELECT address FROM crypto_addresses WHERE user_id = $1 AND chain = $2 AND token = $3', [user_id, chain, token]);
      const amountSats = Math.floor(amount * 1e8);
      result = await btcChain.sendBTC(privateKey, addrRow.address, to_address, amountSats, 'BTC');
    } else if (chain === 'LTC') {
      const addrRow = await queryOne('SELECT address FROM crypto_addresses WHERE user_id = $1 AND chain = $2 AND token = $3', [user_id, chain, token]);
      const amountSats = Math.floor(amount * 1e8);
      result = await btcChain.sendBTC(privateKey, addrRow.address, to_address, amountSats, 'LTC');
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
    console.log('Withdrawal done: ' + amount + ' ' + token + '@' + chain + ' tx=' + result.txHash);
    return result;

  } catch (e) {
    await query(
      "UPDATE crypto_withdrawals SET status = 'failed', error = $1 WHERE id = $2",
      [e.message, withdrawalId]
    );
    console.error('Withdrawal failed ' + withdrawalId + ': ' + e.message);
    throw e;
  }
}

module.exports = { processWithdrawal };
