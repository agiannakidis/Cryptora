const { createClient } = require('@clickhouse/client');

const ch = createClient({
  url:      process.env.CH_HOST     || 'http://localhost:8123',
  database: process.env.CH_DATABASE || 'casino',
  username: process.env.CH_USER     || 'default',
  password: process.env.CH_PASSWORD || '',
  request_timeout: 30000,
});

async function insert(table, rows) {
  if (!rows || rows.length === 0) return;
  await ch.insert({ table, values: rows, format: 'JSONEachRow' });
}

async function queryAll(sql, params = {}) {
  const result = await ch.query({ query: sql, query_params: params, format: 'JSONEachRow' });
  return result.json();
}

async function queryOne(sql, params = {}) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

module.exports = { ch, insert, queryAll, queryOne };
