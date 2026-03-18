-- 
CREATE TABLE casino.bets\n(\n    `id` String,\n    `user_id` String,\n    `user_email` String,\n    `game_id` String,\n    `game_title` String,\n    `provider` String,\n    `session_id` String,\n    `round_id` String,\n    `bet_amount` Float64,\n    `win_amount` Float64,\n    `currency` String DEFAULT \'USD\',\n    `multiplier` Float64 DEFAULT 0,\n    `is_win` UInt8 DEFAULT 0,\n    `balance_before` Float64 DEFAULT 0,\n    `balance_after` Float64 DEFAULT 0,\n    `created_at` DateTime64(3) DEFAULT now64()\n)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(created_at)\nORDER BY (created_at, user_id, game_id)\nSETTINGS index_granularity = 8192

-- 
CREATE TABLE casino.crypto_deposits\n(\n    `id` String,\n    `user_id` String,\n    `chain` String,\n    `token` String,\n    `amount_crypto` Float64,\n    `amount_usd` Float64,\n    `tx_hash` String,\n    `confirmations` UInt32 DEFAULT 0,\n    `status` String DEFAULT \'confirmed\',\n    `credited` UInt8 DEFAULT 1,\n    `created_at` DateTime64(3) DEFAULT now64(),\n    `confirmed_at` DateTime64(3) DEFAULT now64()\n)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(created_at)\nORDER BY (created_at, user_id, chain)\nSETTINGS index_granularity = 8192

-- 
CREATE TABLE casino.game_events\n(\n    `id` String,\n    `event_type` String,\n    `user_id` String,\n    `user_email` String,\n    `game_id` String,\n    `game_title` String,\n    `provider` String,\n    `session_id` String,\n    `data` String DEFAULT \'{}\',\n    `created_at` DateTime64(3) DEFAULT now64()\n)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(created_at)\nORDER BY (created_at, user_id, event_type)\nSETTINGS index_granularity = 8192

-- 
CREATE TABLE casino.operator_transactions\n(\n    `id` String,\n    `operator_id` String,\n    `operator_username` String,\n    `player_id` String,\n    `player_username` String,\n    `type` String,\n    `amount` Float64,\n    `note` String,\n    `created_at` DateTime\n)\nENGINE = MergeTree\nORDER BY (created_at, operator_id)\nSETTINGS index_granularity = 8192

-- 
CREATE TABLE casino.transactions\n(\n    `id` String,\n    `user_id` String,\n    `user_email` String,\n    `type` String,\n    `amount` Float64,\n    `currency` String DEFAULT \'USD\',\n    `status` String DEFAULT \'completed\',\n    `description` String,\n    `reference` String,\n    `created_at` DateTime64(3) DEFAULT now64()\n)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(created_at)\nORDER BY (created_at, user_id, type)\nSETTINGS index_granularity = 8192

-- 
CREATE TABLE casino.wallet_api_logs\n(\n    `id` String DEFAULT toString(generateUUIDv4()),\n    `action` String,\n    `user_id` String,\n    `username` String,\n    `session_id` String,\n    `round_id` String,\n    `amount` Float64 DEFAULT 0,\n    `balance_before` Float64 DEFAULT 0,\n    `balance_after` Float64 DEFAULT 0,\n    `currency` String DEFAULT \'USD\',\n    `game_id` String DEFAULT \'\',\n    `provider` String DEFAULT \'\',\n    `request_raw` String DEFAULT \'{}\',\n    `response_status` String DEFAULT \'ok\',\n    `error_msg` String DEFAULT \'\',\n    `operator_id` String DEFAULT \'\',\n    `created_at` DateTime64(3) DEFAULT now64()\n)\nENGINE = MergeTree\nORDER BY (created_at, user_id)\nSETTINGS index_granularity = 8192

