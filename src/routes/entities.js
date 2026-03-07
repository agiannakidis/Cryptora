const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryOne, queryAll, query } = require('../pgdb');
const { queryAll: chQueryAll } = require('../chdb');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Entity → table mapping (PostgreSQL)
const ENTITY_MAP = {
  Game:          'games',
  GameProvider:  'game_providers',
  GameSession:   'game_sessions',
  Promotion:     'promotions',
  Support:       'support',
  User:          'users',
  // Transaction is in ClickHouse — handled separately
};

// CH entities
const CH_ENTITIES = { Transaction: 'casino.transactions' };

// Allowed columns per entity for PUT (whitelist approach — prevents mass assignment)
const ALLOWED_COLUMNS = {
  users: new Set([
    'name','currency','preferred_currency','favorite_games',
    // admin-only
    'balance','bonus_balance','role','email_verified','vip_level','vip_points',
    'total_wagered','wagering_required','wagering_progress','wagering_bonus_amount',
    'bonus_expires_at','avatar_url','deposit_limit_daily','deposit_limit_weekly',
    'deposit_limit_monthly','loss_limit_daily','loss_limit_weekly','loss_limit_monthly',
    'wager_limit_daily','session_limit_minutes','self_excluded_until',
    'self_excluded_permanent','is_active','notes','updated_date',
  ]),
  games: new Set([
    'title','provider','category','thumbnail','is_active','is_featured',
    'rtp','min_bet','max_bet','tags','description','updated_date',
  ]),
  promotions: new Set([
    'title','description','image','bonus_type','bonus_value','wagering_requirement',
    'min_deposit','is_active','expires_at','updated_date',
  ]),
  game_providers: new Set(['name','api_url','api_base_url','is_active','updated_date']),
  support: new Set(['status','assigned_to','reply','updated_date']),
  jackpot: new Set(['amount','seed_amount','max_amount','contribution_rate','win_chance_base','updated_at']),
};

const ADMIN_ONLY  = ['User'];
const PUBLIC_READ = ['Game', 'GameProvider', 'Promotion'];

function getTable(name) { return ENTITY_MAP[name] || null; }
function isChEntity(name) { return !!CH_ENTITIES[name]; }

function parseSort(sort, isPg = true) {
  if (!sort) return isPg ? 'created_date DESC' : 'created_at DESC';
  const desc = sort.startsWith('-');
  const col  = sort.replace(/^-/, '').replace(/[^a-z0-9_]/gi, '');
  return `${col} ${desc ? 'DESC' : 'ASC'}`;
}

// Build WHERE for PG — returns { where, values }
function buildPgFilter(reqQuery) {
  const exclude = ['_sort', '_limit', '_offset'];
  const conditions = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(reqQuery)) {
    if (exclude.includes(key)) continue;
    const col = key.replace(/[^a-z0-9_]/gi, '');
    if (Array.isArray(val)) {
      const placeholders = val.map(() => `$${idx++}`).join(',');
      conditions.push(`${col} IN (${placeholders})`);
      values.push(...val);
    } else {
      conditions.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  return {
    where:  conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

// Numeric fields from PG NUMERIC type come back as strings — convert to JS numbers
const NUMERIC_FIELDS = [
  'balance','bonus_balance','vip_points','total_wagered',
  'wagering_required','wagering_progress','wagering_bonus_amount',
  'affiliate_balance','deposit_limit_daily','deposit_limit_weekly',
  'deposit_limit_monthly','loss_limit_daily','loss_limit_weekly',
  'loss_limit_monthly','wager_limit_daily',
  'total_bet','total_win','amount','balance_after','bet_amount','win_amount',
  'rtp','min_bet','max_bet','jackpot_amount','contribution_percent',
];

// Parse row from PG — normalize booleans, JSON fields, NUMERIC → number
function parseRow(row) {
  if (!row) return null;
  const r = { ...row };
  if (r.password_hash) delete r.password_hash;
  // Convert PG NUMERIC strings to JS numbers
  for (const f of NUMERIC_FIELDS) {
    if (r[f] !== null && r[f] !== undefined) {
      r[f] = parseFloat(r[f]) || 0;
    }
  }
  // JSON fields (stored as jsonb in PG — already parsed)
  if (r.messages && typeof r.messages === 'string') {
    try { r.messages = JSON.parse(r.messages); } catch {}
  }
  if (r.favorite_games && typeof r.favorite_games === 'string') {
    try { r.favorite_games = JSON.parse(r.favorite_games); } catch {}
  }
  // Alias for frontend
  if (r.game_id !== undefined && r.provider_game_id === undefined) {
    r.provider_game_id = r.game_id;
  }
  return r;
}

// ── GET /:entity ──────────────────────────────────────────────────────────────
router.get('/:entity', optionalAuth, async (req, res) => {
  const entityName = req.params.entity;

  // ── Transaction entity — read from PG tx_idempotency (has balance_after) ──
  if (entityName === 'Transaction') {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { queryAll: pgQueryAll } = require('../pgdb');
    const limit  = Math.min(parseInt(req.query._limit) || 100, 500);
    const offset = parseInt(req.query._offset) || 0;
    try {
      let sql, params;
      const HIDDEN_TYPES = "('round_complete')";
      if (req.user.role === 'admin') {
        sql = `SELECT id, user_email, type, amount::float as amount, balance_after::float as balance_after,
                 game_id, game_title, reference, created_at as created_date
               FROM tx_idempotency
               WHERE type NOT IN ${HIDDEN_TYPES}
               ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
        params = [limit, offset];
      } else {
        sql = `SELECT id, user_email, type, amount::float as amount, balance_after::float as balance_after,
                 game_id, game_title, reference, created_at as created_date
               FROM tx_idempotency
               WHERE user_email = $1 AND type NOT IN ${HIDDEN_TYPES}
               ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
        params = [req.user.email, limit, offset];
      }
      const rows = await pgQueryAll(sql, params);
      return res.json(rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount) || 0,
        balance_after: parseFloat(r.balance_after) || 0,
      })));
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ClickHouse entity (legacy) ──
  if (isChEntity(entityName)) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const table  = CH_ENTITIES[entityName];
    const limit  = Math.min(parseInt(req.query._limit) || 100, 500);
    const offset = parseInt(req.query._offset) || 0;
    // CH column aliases: created_date -> created_at, user_email filter -> user_email
    const CH_COL_MAP = { created_date: 'created_at', id: 'id' };
    const rawSort = (req.query._sort || '-created_at');
    const sortDir = rawSort.startsWith('-') ? 'DESC' : 'ASC';
    const sortRaw = rawSort.replace(/^-/, '');
    const sortCol = CH_COL_MAP[sortRaw] || sortRaw;
    const sort    = sortCol + ' ' + sortDir;

    try {
      // Build CH WHERE clause with optional filters
      const chWhere = [];
      const chParams = {};

      if (req.user.role !== 'admin') {
        chWhere.push('user_id = {userId:String}');
        chParams.userId = req.user.id;
      }

      const chExclude = ['_sort', '_limit', '_offset'];
      for (const [key, val] of Object.entries(req.query)) {
        if (chExclude.includes(key)) continue;
        const col = key.replace(/[^a-z0-9_]/gi, '');
        const paramKey = 'p_' + col;
        chWhere.push(`${col} = {${paramKey}:String}`);
        chParams[paramKey] = val;
      }

      let sql = `SELECT * FROM ${table}`;
      if (chWhere.length) sql += ` WHERE ${chWhere.join(' AND ')}`;
      sql += ` ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`;

      const rows = await chQueryAll(sql, chParams);
      // Alias created_at → created_date for frontend compatibility
      const normalized = rows.map(r => ({ ...r, created_date: r.created_at || r.created_date }));
      return res.json(normalized);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PostgreSQL entity ──
  const table = getTable(entityName);
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  if (!PUBLIC_READ.includes(entityName) && !req.user)
    return res.status(401).json({ error: 'Authentication required' });

  if (ADMIN_ONLY.includes(entityName) && req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  const sort   = parseSort(req.query._sort);
  const limit  = entityName === "Game" ? 2000 : Math.min(parseInt(req.query._limit) || 500, 2000);
  const offset = parseInt(req.query._offset) || 0;

  const filterQuery = { ...req.query };
  delete filterQuery._sort;
  delete filterQuery._limit;
  delete filterQuery._offset;

  const { where, values } = buildPgFilter(filterQuery);
  const sql = `SELECT * FROM ${table} ${where} ORDER BY ${sort} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

  try {
    const rows = await queryAll(sql, [...values, limit, offset]);
    res.json(rows.map(parseRow));
  } catch (err) {
    console.error('[entities GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:entity ─────────────────────────────────────────────────────────────
router.post('/:entity', authMiddleware, async (req, res) => {
  const entityName = req.params.entity;
  const table = getTable(entityName);
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  // Only admins can POST to protected entities
  if (ADMIN_WRITE_ENTITIES.includes(entityName) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });

  const rawData = { ...req.body };
  if (!rawData.id) rawData.id = uuidv4();
  if (!rawData.created_date) rawData.created_date = new Date().toISOString();
  rawData.updated_date = new Date().toISOString();

  // Whitelist columns for POST as well
  const allowedCols = ALLOWED_COLUMNS[table];
  const data = {};
  const ALWAYS_ALLOWED = ['id', 'created_date', 'updated_date'];
  for (const [k, v] of Object.entries(rawData)) {
    if (ALWAYS_ALLOWED.includes(k) || !allowedCols || allowedCols.has(k)) {
      data[k] = v;
    }
  }

  // Serialize JSON fields for PG
  if (data.messages && typeof data.messages === 'object')
    data.messages = JSON.stringify(data.messages);
  if (data.favorite_games && typeof data.favorite_games === 'object')
    data.favorite_games = JSON.stringify(data.favorite_games);

  const keys = Object.keys(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;

  try {
    const result = await query(sql, Object.values(data));
    res.status(201).json(parseRow(result.rows[0]));
  } catch (err) {
    console.error('[entities POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:entity/:id ──────────────────────────────────────────────────────────
// PROTECTED FIELDS that only admins can write
const ADMIN_WRITE_FIELDS = ['balance', 'bonus_balance', 'role', 'email_verified',
  'total_wagered', 'vip_level', 'vip_points', 'wagering_required', 'wagering_progress'];

// Entities that require admin for any write
const ADMIN_WRITE_ENTITIES = ['User', 'Game', 'GameProvider', 'Promotion', 'Jackpot'];

router.put('/:entity/:id', authMiddleware, async (req, res) => {
  const entityName = req.params.entity;
  const table = getTable(entityName);
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const isAdmin = req.user.role === 'admin';

  // Non-admins cannot write to protected entities
  if (ADMIN_WRITE_ENTITIES.includes(entityName) && !isAdmin)
    return res.status(403).json({ error: 'Admin only' });

  // Non-admins cannot write protected fields on ANY entity
  if (!isAdmin) {
    for (const field of ADMIN_WRITE_FIELDS) {
      if (req.body[field] !== undefined)
        return res.status(403).json({ error: `Cannot modify protected field: ${field}` });
    }
    // Non-admin can only update their own record
    if (req.params.id !== req.user.id)
      return res.status(403).json({ error: 'Cannot modify other users' });
  }

  const rawData = { ...req.body };
  delete rawData.id;
  rawData.updated_date = new Date().toISOString();

  // Whitelist columns — prevents mass assignment / arbitrary column injection
  const allowedCols = ALLOWED_COLUMNS[table];
  const data = {};
  for (const [k, v] of Object.entries(rawData)) {
    if (!allowedCols || allowedCols.has(k)) {
      data[k] = v;
    } else {
      console.warn(`[entities PUT] Blocked disallowed field: ${k} on ${table}`);
    }
  }
  if (!Object.keys(data).length)
    return res.status(400).json({ error: 'No valid fields to update' });

  if (data.messages && typeof data.messages === 'object')
    data.messages = JSON.stringify(data.messages);
  if (data.favorite_games && typeof data.favorite_games === 'object')
    data.favorite_games = JSON.stringify(data.favorite_games);

  const keys = Object.keys(data);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const sql  = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`;

  try {
    // Read before state for audit log
    let before = null;
    const auditFields = ADMIN_WRITE_FIELDS.filter(f => data[f] !== undefined);
    if (isAdmin && auditFields.length > 0) {
      const b = await queryOne(`SELECT ${auditFields.join(', ')}, email FROM ${table} WHERE id = $1`, [req.params.id]);
      before = b;
    }

    const result = await query(sql, [...Object.values(data), req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    // Audit log for admin changes to protected fields
    if (isAdmin && auditFields.length > 0 && before) {
      const changes = {};
      for (const f of auditFields) {
        changes[f] = { before: before[f], after: data[f] };
      }
      await query(
        `INSERT INTO admin_audit_log (admin_id, admin_email, action, entity, entity_id, changes, ip_address)
         VALUES ($1, $2, 'update', $3, $4, $5, $6)`,
        [req.user.id, req.user.email, entityName, req.params.id,
         JSON.stringify(changes), req.headers['x-forwarded-for'] || req.ip || '']
      ).catch(e => console.error('[audit log]', e.message));
    }

    res.json(parseRow(result.rows[0]));
  } catch (err) {
    console.error('[entities PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:entity/:id ───────────────────────────────────────────────────────
router.delete('/:entity/:id', authMiddleware, async (req, res) => {
  const table = getTable(req.params.entity);
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
