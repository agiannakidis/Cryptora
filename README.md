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



## Database Setup

### PostgreSQL Setup
```bash
createdb casino_db
# No schema.sql — tables auto-created by pgdb.js initSchema() on first startup
# Run: node src/index.js and tables will be created automatically
# If manual schema is needed: pg_dump from a running instance
```

**Note:** `pgdb.js` does NOT have auto-create. Run schema manually if needed:
```bash
# If a schema.sql is provided:
psql casino_db < schema.sql
```

### ClickHouse Setup
```sql
CREATE DATABASE casino;
-- Tables auto-created by chdb.js on first run
```

### SQLite Migration (one-time, from old version)
```bash
NODE_ENV=development ALLOW_MIGRATE=1 node src/migrate.js
```

## Fresh Clone Startup

```bash
git clone https://github.com/agiannakidis/Cryptora
cd Cryptora
npm install
cp .env.example .env
# Edit .env with your values (JWT_SECRET, PG_*, MASTER_MNEMONIC, etc.)
node src/index.js
# On first run: connect to PostgreSQL — ensure DB exists and schema is loaded
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

## Known Limitations and Disabled Features

| Feature | Status | Notes |
|---|---|---|
| **TON deposits** | ❌ Disabled | No deposit monitor loop implemented. Returns 400. TON withdrawals work. |
| **ARBITRUM** | ❌ Fully disabled | No monitor, no deposit, no withdrawal. Returns 400 on all deposit/withdrawal attempts. |
| **LTC deposits** | ⚠️ Limited | Monitored via blockcypher public API (rate-limited to ~3 req/s, no API key). May miss deposits under heavy load. Withdrawals work. |
| **SQLite** | ⚠️ Migration helper only | `src/migrate-sqlite.js` exists for schema reference. Not used at runtime — all production data is in PostgreSQL. |
| **Stripe** | ⚠️ Not implemented | Declared in `.env.example` but no Stripe routes exist. Planned for future card deposit support. |

### Planned Improvements
- TON deposit monitoring (requires TON Center or tonclient polling loop)
- ARBITRUM support (requires Arbitrum RPC endpoint and event subscription)
- LTC: migrate from blockcypher to litecoinspace.org for higher rate limits
