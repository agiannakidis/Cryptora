const { HDKey } = require('@scure/bip32');
const bip39 = require('bip39');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');
const { Keypair } = require('@solana/web3.js');
const { derivePath } = require('ed25519-hd-key');
const xrpl = require('xrpl');
const { CHAINS } = require('./config');
const { queryOne, query } = require('../pgdb');
const { v4: uuidv4 } = require('uuid');

const ECPair = ECPairFactory(ecc);

// Litecoin network params
const LITECOIN_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

// Get master seed from env
function getMasterSeed() {
  if (!process.env.MASTER_MNEMONIC) {
    console.error('⚠️  MASTER_MNEMONIC not set in .env!');
    console.error('Run: node -e "require(\'bip39\').generateMnemonic(256)" to generate one.');
    process.exit(1);
  }
  if (!bip39.validateMnemonic(process.env.MASTER_MNEMONIC)) {
    console.error('⚠️  MASTER_MNEMONIC is invalid!');
    process.exit(1);
  }
  return bip39.mnemonicToSeedSync(process.env.MASTER_MNEMONIC);
}

let _masterSeed = null;
function getMaster() {
  if (!_masterSeed) _masterSeed = getMasterSeed();
  return _masterSeed;
}

// Derive child key
function deriveChild(derivationPath, index) {
  const seed = getMaster();
  const root = HDKey.fromMasterSeed(seed);
  return root.derive(`${derivationPath}/${index}`);
}

// Generate address for a chain at a specific index
function generateAddress(chainId, index) {
  const chain = CHAINS[chainId];

  if (chain.type === 'bitcoin') {
    const child = deriveChild(chain.derivationPath, index);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), { network: bitcoin.networks.bitcoin });
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: bitcoin.networks.bitcoin });
    return { address, privateKey: Buffer.from(child.privateKey).toString('hex') };
  }

  if (chain.type === 'litecoin') {
    const child = deriveChild(chain.derivationPath, index);
    const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), { network: LITECOIN_NETWORK });
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: LITECOIN_NETWORK });
    return { address, privateKey: Buffer.from(child.privateKey).toString('hex') };
  }

  if (chain.type === 'evm') {
    const child = deriveChild(chain.derivationPath, index);
    const wallet = new ethers.Wallet(Buffer.from(child.privateKey).toString('hex'));
    return { address: wallet.address, privateKey: Buffer.from(child.privateKey).toString('hex') };
  }

  if (chain.type === 'tron') {
    const child = deriveChild(chain.derivationPath, index);
    const privHex = Buffer.from(child.privateKey).toString('hex');
    const tronAddress = TronWeb.address.fromPrivateKey(privHex);
    return { address: tronAddress, privateKey: privHex };
  }

  if (chain.type === 'solana') {
    const seed = getMaster();
    const path = `m/44'/501'/${index}'/0'`;
    const derived = derivePath(path, seed.toString('hex'));
    const keypair = Keypair.fromSeed(derived.key);
    return {
      address: keypair.publicKey.toString(),
      privateKey: Buffer.from(keypair.secretKey).toString('hex'),
    };
  }

  if (chain.type === 'xrp') {
    const child = deriveChild(chain.derivationPath, index);
    const wallet = new xrpl.Wallet(Buffer.from(child.privateKey).toString('hex'));
    return { address: wallet.address, privateKey: Buffer.from(child.privateKey).toString('hex') };
  }

  if (chain.type === 'ton') {
    // TON uses async address generation — handled separately
    return { address: null, privateKey: null, requiresAsync: true };
  }

  throw new Error(`Unknown chain type: ${chain.type}`);
}

// Generate TON address asynchronously
async function generateTonAddress(index) {
  try {
    const { WalletContractV4 } = require('@ton/ton');
    const { mnemonicToPrivateKey } = require('@ton/crypto');
    const mnemonic = process.env.MASTER_MNEMONIC.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
      walletId: index,
    });
    return wallet.address.toString({ bounceable: false });
  } catch (e) {
    console.error('TON address generation failed:', e.message);
    return null;
  }
}

// Get or create deposit address for user+chain+token
async function getUserAddress(userId, chainId, token) {
  // Check PG cache first
  const existing = await queryOne(
    'SELECT address FROM crypto_addresses WHERE user_id = $1 AND chain = $2 AND token = $3',
    [userId, chainId, token]
  );
  if (existing) return existing.address;

  const chain = CHAINS[chainId];

  // For EVM chains — same address for all tokens on same chain
  if (chain.type === 'evm') {
    const evmExisting = await queryOne(
      'SELECT address, derivation_index FROM crypto_addresses WHERE user_id = $1 AND chain = $2 LIMIT 1',
      [userId, chainId]
    );
    if (evmExisting) {
      await query(
        'INSERT INTO crypto_addresses (id, user_id, chain, token, address, derivation_index) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [uuidv4(), userId, chainId, token, evmExisting.address, evmExisting.derivation_index]
      );
      return evmExisting.address;
    }
  }

  // Find next index for this chain
  const maxRow = await queryOne(
    'SELECT MAX(derivation_index) as max_idx FROM crypto_addresses WHERE chain = $1',
    [chainId]
  );
  const index = (maxRow?.max_idx !== null && maxRow?.max_idx !== undefined ? parseInt(maxRow.max_idx) : -1) + 1;

  let address;
  if (chain.type === 'ton') {
    address = await generateTonAddress(index);
  } else {
    const result = generateAddress(chainId, index);
    address = result.address;
  }

  if (!address) throw new Error(`Failed to generate ${chainId} address`);

  await query(
    'INSERT INTO crypto_addresses (id, user_id, chain, token, address, derivation_index) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [uuidv4(), userId, chainId, token, address, index]
  );

  // For EVM: pre-create rows for other tokens on same chain (same address)
  if (chain.type === 'evm') {
    for (const t of chain.tokens) {
      if (t !== token) {
        await query(
          'INSERT INTO crypto_addresses (id, user_id, chain, token, address, derivation_index) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [uuidv4(), userId, chainId, t, address, index]
        );
      }
    }
  }

  return address;
}

// Get private key for withdrawal (async — reads from PG)
async function getPrivateKey(userId, chainId, token) {
  const row = await queryOne(
    'SELECT derivation_index FROM crypto_addresses WHERE user_id = $1 AND chain = $2 AND token = $3',
    [userId, chainId, token]
  );
  if (!row) throw new Error('Address not found for this user/chain/token');

  const chain = CHAINS[chainId];
  if (chain.type === 'ton') throw new Error('TON withdrawal not yet implemented');

  const result = generateAddress(chainId, parseInt(row.derivation_index));
  return result.privateKey;
}

module.exports = { getUserAddress, getPrivateKey, generateAddress };
