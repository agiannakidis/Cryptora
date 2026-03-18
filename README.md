# Cryptora Casino Backend

Production-grade Node.js casino backend for [cryptora.live](https://cryptora.live).

## Stack

- **Runtime:** Node.js (Express)
- **Database:** PostgreSQL (primary), ClickHouse (analytics)
- **Auth:** JWT (RS256-compatible secret)
- **Crypto:** Multi-chain HD wallet (ETH, BTC, TRX, SOL, XRP, TON, BSC, POLYGON, LTC)
- **Game providers:** GrandX / Pragmatic Play, game-services.work RGS
- **Geo-blocking:** IP-based restriction middleware

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in all REQUIRED values

# 3. Generate a strong JWT secret
openssl rand -hex 32

# 4. Run database migrations
npm run migrate

# 5. Start (development)
npm run dev

# 6. Start (production)
npm start
```

## Environment Variables

Copy `.env.example` to `.env` and fill in real values. **Never commit `.env` to version control.**

Key required vars:

| Variable | Description |
|---|---|
| `JWT_SECRET` | Min 32 chars, generate with `openssl rand -hex 32` |
| `PG_HOST` | PostgreSQL host |
| `PG_USER` | PostgreSQL user |
| `PG_DATABASE` | PostgreSQL database name |
| `PG_PASSWORD` | PostgreSQL password |
| `MASTER_MNEMONIC` | BIP39 mnemonic for HD wallet (256-bit, never lose this) |

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start with file watching (development) |
| `npm test` | Run tests |
| `npm run migrate` | Run database migrations |

## Supported Chains

| Chain | Deposits | Withdrawals | Notes |
|---|---|---|---|
| TRX | ✅ | ✅ | TRC-20 USDT supported |
| ETH | ✅ | ✅ | ERC-20 USDT/USDC |
| BSC | ✅ | ✅ | BEP-20 tokens |
| POLYGON | ✅ | ✅ | |
| BTC | ✅ | ✅ | Native Bitcoin |
| LTC | ✅ | ✅ | |
| SOL | ✅ | ✅ | SPL tokens |
| XRP | ✅ | ✅ | |
| TON | ✅ | ✅ | |
| ARBITRUM | ❌ | ❌ | Not implemented — disabled |

## Project Structure

```
src/
├── index.js          # Entry point, startup validation
├── pgdb.js           # PostgreSQL connection pool
├── clickhouse.js     # ClickHouse analytics client
├── geo-block.js      # IP geo-restriction middleware
├── middleware/
│   └── auth.js       # JWT authentication middleware
├── routes/
│   ├── auth.js       # Player registration/login
│   ├── crypto.js     # Deposit addresses, withdrawals, price feeds
│   ├── games.js      # Game launch, provider integration
│   ├── jackpot.js    # Progressive jackpot
│   ├── affiliate.js  # Affiliate program
│   ├── operatorAuth.js  # Operator/admin auth
│   └── ...
├── crypto/
│   ├── wallet.js     # HD wallet key derivation
│   └── chains/       # Per-chain transaction logic
tests/
└── startup.test.js   # Environment and module sanity checks
```

## Security Notes

- `JWT_SECRET` must be set via environment — no hardcoded fallbacks
- `.env` is gitignored; never commit secrets
- Database files (`*.db`, `*.wal`, `*.shm`) are gitignored
- ARBITRUM chain is disabled (monitoring not implemented)
- All admin endpoints require JWT with `role: admin`

## Deployment (Hetzner)

Server: `root@89.167.108.79`

```bash
# SSH in
ssh root@89.167.108.79

# Pull latest
cd /root/casino-backend && git pull

# Restart service
pm2 restart casino-backend
```

## License

Private — all rights reserved.
