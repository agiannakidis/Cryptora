# Cryptora — Operations Runbook

## Service Overview
- **App:** Node.js/Express, port 3001, managed by PM2
- **DB:** PostgreSQL (primary OLTP)
- **Analytics:** ClickHouse (optional)
- **Proxy:** Nginx → port 3001
- **Crypto watchers:** embedded in app process

## Common Operations

### Restart Application
```bash
pm2 restart casino-backend
pm2 status casino-backend
```

### Check Health
```bash
curl https://cryptora.live/api/health
# Expected: {"ok":true,"time":"..."}
```

### View Logs
```bash
pm2 logs casino-backend --lines 100
pm2 logs casino-backend --err --lines 50
```

### Database Backup
```bash
PGPASSWORD=$PG_PASSWORD pg_dump -U casino -d casino_db -h localhost \
  --no-owner --no-acl -f backup_$(date +%Y%m%d_%H%M%S).sql
```

### Check Pending Withdrawals
```bash
PGPASSWORD=$PG_PASSWORD psql -U casino -d casino_db -h localhost \
  -c "SELECT id, user_id, chain, token, amount, status, created_at FROM crypto_withdrawals WHERE status='pending' ORDER BY created_at;"
```

## Incident Response

### Stuck Withdrawal
1. Check logs: `pm2 logs casino-backend --err | grep withdrawal`
2. Check withdrawal status in DB
3. If stuck in 'processing' > 30min: manually reset to 'pending' and refund:
```sql
UPDATE crypto_withdrawals SET status='pending' WHERE id='WITHDRAWAL_ID' AND status='processing';
```
4. If failed: ensure balance was refunded (check transactions table for 'refund' type)

### Watcher Down (no deposits credited)
1. Check logs for monitor errors
2. Check RPC connectivity: `curl https://api.trongrid.io/v1/blocks/latest`
3. Restart app: `pm2 restart casino-backend`
4. Monitor logs: `pm2 logs casino-backend | grep Monitor`

### RPC Outage (BSC/ETH/POLYGON)
1. Identify which chain: check logs for "could not coalesce error"
2. Temporary fix: update RPC in .env and restart
3. Long-term: switch to private RPC (Alchemy/Infura)

### Database Failover
1. Update PG_HOST in .env to replica
2. Restart: `pm2 restart casino-backend`
3. Verify: `curl http://localhost:3001/api/health`

## Deployment

### Normal Deploy
```bash
cd /root/casino-backend
git pull origin main
npm install --production
pm2 restart casino-backend
sleep 3
curl http://localhost:3001/api/health
```

### Rollback
```bash
cd /root/casino-backend
git log --oneline -5  # find previous commit
git checkout <commit-hash>
pm2 restart casino-backend
```

### Schema Migration (first deploy)
```bash
NODE_ENV=development ALLOW_MIGRATE=1 psql -U casino -d casino_db -h localhost -f schema.sql
```

## Monitoring Checklist (daily)
- [ ] Health endpoint returns ok
- [ ] No ERROR logs in last hour
- [ ] Pending withdrawals count < 10 (investigate if more)
- [ ] Hot wallet TRX balance > 10 TRX (for gas)
- [ ] PM2 restart count reasonable (< 5/day)
