# Cryptora — Supported Crypto Assets

This document is the authoritative source of truth for crypto asset support.
**Last updated:** auto-generated from config

## Support Matrix

| Chain | Token | Deposit | Monitoring | Withdrawal | Notes |
|-------|-------|---------|------------|------------|-------|
| TRX | TRX | ✅ | ✅ TronGrid API | ✅ | Requires TRONGRID_API_KEY |
| TRX | USDT | ✅ | ✅ TronGrid TRC-20 | ✅ | Primary USDT route |
| TRX | USDC | ✅ | ✅ TronGrid TRC-20 | ✅ | |
| ETH | ETH | ✅ | ✅ publicnode.com | ✅ | Replace RPC for production |
| ETH | USDT | ✅ | ✅ ERC-20 events | ✅ | |
| ETH | USDC | ✅ | ✅ ERC-20 events | ✅ | |
| BSC | BNB | ✅ | ✅ bsc-dataseed1 | ✅ | Replace RPC for production |
| BSC | USDT | ✅ | ✅ BEP-20 events | ✅ | |
| BSC | USDC | ✅ | ✅ BEP-20 events | ✅ | |
| POLYGON | MATIC | ✅ | ✅ polygon-rpc.com | ✅ | Replace RPC for production |
| POLYGON | USDT | ✅ | ✅ | ✅ | |
| POLYGON | USDC | ✅ | ✅ | ✅ | |
| BTC | BTC | ✅ | ✅ blockstream.info | ✅ | |
| LTC | LTC | ✅ | ⚠️ blockcypher (rate limited) | ✅ | Add BLOCKCYPHER_API_KEY for production |
| SOL | SOL | ✅ | ✅ mainnet-beta RPC | ✅ | |
| SOL | USDC | ❌ | ❌ Not implemented | ❌ | Guards in place, returns 400 |
| XRP | XRP | ✅ | ✅ s1.ripple.com | ✅ | |
| TON | TON | ❌ | ❌ No polling loop | ✅ | Withdrawal works, deposit disabled |
| ARBITRUM | ETH | ❌ | ❌ Disabled | ❌ | Fully disabled, returns 400 |
| ARBITRUM | USDC | ❌ | ❌ Disabled | ❌ | Fully disabled, returns 400 |
| ARBITRUM | USDT | ❌ | ❌ Disabled | ❌ | Fully disabled, returns 400 |

## Legend
- ✅ Fully implemented and tested
- ⚠️ Implemented with known limitations
- ❌ Disabled — returns 400 with clear error message

## Adding a New Asset
1. Add to `src/crypto/config.js`
2. Implement monitoring in `src/crypto/monitor.js`
3. Implement withdrawal in `src/crypto/withdraw.js`
4. Add address generation in `src/crypto/wallet.js`
5. Update this document
6. Add test in `tests/startup.test.js`
