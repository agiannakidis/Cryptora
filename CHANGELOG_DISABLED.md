# Cryptora — Intentionally Disabled Features

This document lists features that are disabled in the current production build,
along with the reason and re-enable path.

## Crypto Assets

### ARBITRUM (all tokens)
- **Status:** Fully disabled
- **Reason:** No deposit monitoring implemented
- **Error:** HTTP 400 with message
- **Re-enable:** Implement EVM monitor loop for Arbitrum chainId 42161

### TON deposits
- **Status:** Deposits disabled, withdrawals enabled
- **Reason:** No incoming tx polling loop for TON
- **Error:** HTTP 400 with message
- **Re-enable:** Implement tonChain monitoring loop, remove guard in crypto.js

### SOL USDC
- **Status:** Fully disabled (deposit + withdrawal)
- **Reason:** SPL token monitoring not implemented
- **Error:** HTTP 400 with message
- **Re-enable:** Implement SPL token balance polling in solana.js

## Frontend

### 2FA Withdrawal UI
- **File removed:** 2fa-withdrawal.js
- **Status:** 2FA still enforced on backend (TOTP check in withdrawal route)
- **UI:** 2FA setup/management moved to profile-page.js

## Infrastructure

### BSC/POLYGON
- **Status:** Enabled but using public RPCs
- **Risk:** Rate limited on production load
- **Fix:** Replace RPC with Alchemy/Infura/QuickNode private node

### LTC monitoring
- **Status:** Enabled via blockcypher.com public API
- **Limitation:** 3 req/s rate limit without API key
- **Fix:** Add BLOCKCYPHER_API_KEY env var
