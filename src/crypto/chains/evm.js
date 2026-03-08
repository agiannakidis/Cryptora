const { ethers } = require('ethers');
const { CHAINS, ERC20_ABI } = require('../config');

const providers = {};

function getProvider(chainId) {
  if (!providers[chainId]) {
    const chain = CHAINS[chainId];
    providers[chainId] = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
  }
  return providers[chainId];
}

// Get native token balance (ETH/BNB/MATIC)
async function getNativeBalance(chainId, address) {
  const provider = getProvider(chainId);
  const balance = await provider.getBalance(address);
  return parseFloat(ethers.formatEther(balance));
}

// Get ERC-20 token balance
async function getTokenBalance(chainId, address, contractAddress) {
  const provider = getProvider(chainId);
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
  const [balance, decimals] = await Promise.all([
    contract.balanceOf(address),
    contract.decimals(),
  ]);
  return parseFloat(ethers.formatUnits(balance, decimals));
}

// Get incoming ERC-20 transfers (last N blocks)
async function getIncomingTokenTransfers(chainId, address, contractAddress, fromBlock) {
  const provider = getProvider(chainId);
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);

  const currentBlock = await provider.getBlockNumber();
  const rawStart = fromBlock || 0;
  const startBlock = Math.max(rawStart, currentBlock - 499); // Cap at 900 blocks (free RPC limit)

  const filter = contract.filters.Transfer(null, address);
  const logs = await contract.queryFilter(filter, startBlock, currentBlock);

  const decimals = await contract.decimals().catch(() => 6);

  return logs.map(log => ({
    txHash: log.transactionHash,
    from: log.args[0],
    to: log.args[1],
    amount: parseFloat(ethers.formatUnits(log.args[2], decimals)),
    blockNumber: log.blockNumber,
    confirmed: true,
  }));
}

// Send native token (ETH/BNB/MATIC)
async function sendNative(chainId, privateKey, toAddress, amount) {
  const provider = getProvider(chainId);
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amount.toString()),
  });

  await tx.wait(1);
  return { txHash: tx.hash };
}

// Send ERC-20 token
async function sendToken(chainId, privateKey, toAddress, amount, contractAddress, decimals = 6) {
  const provider = getProvider(chainId);
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, wallet);

  const amountWei = ethers.parseUnits(amount.toString(), decimals);
  const tx = await contract.transfer(toAddress, amountWei);
  await tx.wait(1);

  return { txHash: tx.hash };
}

// Get current block number
async function getCurrentBlock(chainId) {
  const provider = getProvider(chainId);
  return provider.getBlockNumber();
}

// Get tx confirmations
async function getConfirmations(chainId, txHash) {
  const provider = getProvider(chainId);
  const [receipt, block] = await Promise.all([
    provider.getTransactionReceipt(txHash),
    provider.getBlockNumber(),
  ]);
  if (!receipt) return 0;
  return block - receipt.blockNumber;
}

module.exports = {
  getNativeBalance,
  getTokenBalance,
  getIncomingTokenTransfers,
  sendNative,
  sendToken,
  getCurrentBlock,
  getConfirmations,
};
