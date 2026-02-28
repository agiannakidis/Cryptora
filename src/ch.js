// ClickHouse connection
const { createClient } = require('@clickhouse/client');

const ch = createClient({
  host:     process.env.CH_HOST     || 'http://localhost:8123',
  database: process.env.CH_DATABASE || 'casino',
  username: process.env.CH_USER     || 'default',
  password: process.env.CH_PASSWORD || '',
  request_timeout: 30000,
  compression: { response: true, request: false },
});

// Insert rows into a table
async function insert(table, rows) {
  if (!rows || rows.length === 0) return;
  await ch.insert({
    table,
    values: rows,
    format: 'JSONEachRow',
  });
}

// Query — returns array of objects
async function queryAll(sql, params = {}) {
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  });
  return result.json();
}

// Query — returns single row
async function queryOne(sql, params = {}) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

module.exports = { ch, insert, queryAll, queryOne };
