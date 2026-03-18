--
-- PostgreSQL database dump
--

\restrict lUyedrhnPehiGzXlPDomUZGA6LWFhwPDXigsGzuPa3mAIP3rFPiuSFDGukd2bhP

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    admin_email character varying(255),
    action character varying(100) NOT NULL,
    entity character varying(100),
    entity_id character varying(255),
    changes jsonb,
    ip_address character varying(45),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    email_confirmed boolean DEFAULT false,
    confirm_code text,
    confirm_code_expires timestamp with time zone
);


--
-- Name: affiliate_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id text NOT NULL,
    ref_code text NOT NULL,
    sub1 text,
    sub2 text,
    sub3 text,
    ip text,
    user_agent text,
    country text,
    landing_url text,
    converted boolean DEFAULT false,
    converted_user_id text,
    converted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    affiliate_id text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_ggr numeric(20,8) DEFAULT 0,
    revshare_percent numeric(5,2) DEFAULT 0,
    amount numeric(20,8) DEFAULT 0,
    status text DEFAULT 'pending'::text,
    paid_at timestamp with time zone,
    paid_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_earnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_earnings (
    id text NOT NULL,
    affiliate_id text,
    referred_user_id text,
    type text,
    amount numeric(20,8) DEFAULT 0,
    description text,
    created_date timestamp with time zone DEFAULT now(),
    account_id uuid
);


--
-- Name: affiliate_events_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_events_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    player_id text NOT NULL,
    affiliate_id text,
    external_id text,
    amount1 numeric(20,8) DEFAULT 0,
    amount2 numeric(20,8) DEFAULT 0,
    meta jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: affiliate_player_daily_ngr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_player_daily_ngr (
    date date NOT NULL,
    player_id text NOT NULL,
    affiliate_id text,
    ggr numeric(20,8) DEFAULT 0,
    bonuses numeric(20,8) DEFAULT 0,
    fees numeric(20,8) DEFAULT 0,
    ngr numeric(20,8) DEFAULT 0,
    bet_count integer DEFAULT 0
);


--
-- Name: affiliate_referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_referrals (
    id text NOT NULL,
    affiliate_id text,
    referred_user_id text,
    referred_user_email text,
    status text DEFAULT 'registered'::text,
    first_deposit_amount numeric(20,8) DEFAULT 0,
    first_deposit_date timestamp with time zone,
    cpa_paid boolean DEFAULT false,
    total_wagered numeric(20,8) DEFAULT 0,
    total_ggr numeric(20,8) DEFAULT 0,
    created_date timestamp with time zone DEFAULT now()
);


--
-- Name: affiliates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliates (
    id text NOT NULL,
    user_id text,
    ref_code text,
    status text DEFAULT 'active'::text,
    commission_type text DEFAULT 'hybrid'::text,
    cpa_amount numeric(10,2) DEFAULT 20,
    revshare_percent numeric(5,2) DEFAULT 25,
    total_earned numeric(20,8) DEFAULT 0,
    total_paid numeric(20,8) DEFAULT 0,
    postback_url text,
    notes text,
    created_date timestamp with time zone DEFAULT now(),
    account_id uuid
);


--
-- Name: banner_slides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banner_slides (
    id text NOT NULL,
    "position" integer DEFAULT 0,
    title text,
    subtitle text,
    description text,
    background_image text,
    overlay_color text DEFAULT 'from-black/70 via-black/50 to-black/60'::text,
    accent text DEFAULT 'text-yellow-300'::text,
    badge text,
    cta_text text DEFAULT 'Play Now'::text,
    cta_link text DEFAULT 'Home'::text,
    cta_color text DEFAULT 'bg-[#f0c040] text-[#0a0e1a] hover:bg-yellow-300'::text,
    active boolean DEFAULT true,
    created_date timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    sender character varying(10) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_messages_sender_check CHECK (((sender)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: chat_messages_old; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages_old (
    id bigint NOT NULL,
    user_id text,
    username text,
    role text DEFAULT 'player'::text,
    message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages_old.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    user_email text,
    user_name text,
    status character varying(20) DEFAULT 'open'::character varying,
    unread_admin integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone DEFAULT now()
);


--
-- Name: community_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_messages (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    username character varying(100) NOT NULL,
    role character varying(20) DEFAULT 'user'::character varying NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.community_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: community_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.community_messages_id_seq OWNED BY public.community_messages.id;


--
-- Name: crypto_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crypto_addresses (
    id text NOT NULL,
    user_id text NOT NULL,
    chain text NOT NULL,
    token text NOT NULL,
    address text NOT NULL,
    derivation_index integer NOT NULL,
    created_date timestamp with time zone DEFAULT now()
);


--
-- Name: crypto_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crypto_withdrawals (
    id text NOT NULL,
    user_id text NOT NULL,
    chain text NOT NULL,
    token text NOT NULL,
    amount_crypto numeric(30,10) NOT NULL,
    amount_usd numeric(20,8),
    to_address text NOT NULL,
    tx_hash text,
    fee_crypto numeric(30,10),
    status text DEFAULT 'pending'::text,
    error text,
    created_date timestamp with time zone DEFAULT now(),
    processed_date timestamp with time zone,
    user_email text,
    reject_reason text,
    approved_by text
);


--
-- Name: deposit_wallet_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deposit_wallet_settings (
    id integer NOT NULL,
    chain text NOT NULL,
    token text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    label text,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: deposit_wallet_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deposit_wallet_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deposit_wallet_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deposit_wallet_settings_id_seq OWNED BY public.deposit_wallet_settings.id;


--
-- Name: game_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_providers (
    id text NOT NULL,
    name text NOT NULL,
    is_enabled boolean DEFAULT true,
    logo text,
    created_date timestamp with time zone DEFAULT now(),
    updated_date timestamp with time zone DEFAULT now(),
    api_base_url text,
    slug text,
    game_count integer DEFAULT 0
);


--
-- Name: game_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_sessions (
    id text NOT NULL,
    user_id text,
    user_email text,
    game_id text,
    game_title text,
    provider text,
    session_token text,
    status text DEFAULT 'active'::text,
    start_time timestamp with time zone DEFAULT now(),
    end_time timestamp with time zone,
    launch_url text,
    created_date timestamp with time zone DEFAULT now(),
    total_bet numeric(20,8) DEFAULT 0,
    total_win numeric(20,8) DEFAULT 0,
    updated_date timestamp with time zone
);


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id text NOT NULL,
    title text NOT NULL,
    provider text,
    category text DEFAULT 'slots'::text,
    thumbnail text,
    is_enabled boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    game_id text,
    provider_game_id text,
    rtp numeric(5,2),
    created_date timestamp with time zone DEFAULT now(),
    updated_date timestamp with time zone DEFAULT now(),
    launch_url text,
    slug text,
    has_jackpot boolean DEFAULT false,
    min_bet numeric(10,4) DEFAULT 0,
    max_bet numeric(10,4) DEFAULT 1000,
    play_count integer DEFAULT 0,
    categories text[] DEFAULT '{}'::text[],
    sort_order integer DEFAULT 0
);


--
-- Name: invalidated_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invalidated_tokens (
    token_hash character varying(64) NOT NULL,
    invalidated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: jackpot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jackpot (
    id text NOT NULL,
    amount numeric(20,8) DEFAULT 10000,
    seed_amount numeric(20,8) DEFAULT 5000,
    contribution_rate numeric(10,6) DEFAULT 0.0001,
    total_contributed numeric(20,8) DEFAULT 0,
    last_won_at timestamp with time zone,
    last_winner_email text,
    last_winner_amount numeric(20,8),
    updated_at timestamp with time zone DEFAULT now(),
    max_amount numeric(20,8) DEFAULT 100000,
    win_chance_base numeric(12,8) DEFAULT 0.00001
);


--
-- Name: jackpot_winners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jackpot_winners (
    id text NOT NULL,
    user_id text,
    user_email text,
    amount numeric(20,8),
    game_title text,
    won_at timestamp with time zone DEFAULT now()
);


--
-- Name: operator_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid,
    sender text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone
);


--
-- Name: operator_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid,
    username text NOT NULL,
    password_hash text NOT NULL,
    balance numeric(20,2) DEFAULT 0,
    currency text DEFAULT 'USD'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    in_game boolean DEFAULT false,
    last_seen timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: operator_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid NOT NULL,
    provider_id text NOT NULL,
    provider_name text NOT NULL,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: operator_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid,
    player_id uuid,
    type text NOT NULL,
    amount numeric(20,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT 'pending_email'::text NOT NULL,
    email_token text,
    email_verified_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by text,
    balance numeric(20,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    notes text,
    owner_admin_id text
);


--
-- Name: promotion_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_claims (
    id text NOT NULL,
    user_id text,
    user_email text,
    promotion_id text,
    bonus_amount numeric(20,8) DEFAULT 0,
    status text DEFAULT 'active'::text,
    claimed_at timestamp with time zone DEFAULT now()
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    image text,
    bonus_type text,
    bonus_value numeric(20,8),
    wagering_requirement numeric(10,2),
    min_deposit numeric(20,8),
    is_active boolean DEFAULT true,
    expires_at timestamp with time zone,
    created_date timestamp with time zone DEFAULT now(),
    updated_date timestamp with time zone DEFAULT now()
);


--
-- Name: rg_daily_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rg_daily_stats (
    user_id text NOT NULL,
    date text NOT NULL,
    deposited numeric(20,8) DEFAULT 0,
    lost numeric(20,8) DEFAULT 0,
    wagered numeric(20,8) DEFAULT 0
);


--
-- Name: rgs_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rgs_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_token character varying(512) NOT NULL,
    session_id character varying(255) NOT NULL,
    user_id text NOT NULL,
    game_uuid character varying(255) NOT NULL,
    currency character varying(10) DEFAULT 'USD'::character varying,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval)
);


--
-- Name: rgs_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rgs_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id character varying(512) NOT NULL,
    player_id uuid NOT NULL,
    session_id character varying(255) NOT NULL,
    round_id character varying(512) NOT NULL,
    game_uuid character varying(255) NOT NULL,
    debit_amount numeric(18,8) DEFAULT 0,
    credit_amount numeric(18,8) DEFAULT 0,
    net_amount numeric(18,8) DEFAULT 0,
    currency character varying(10) DEFAULT 'USD'::character varying,
    transaction_type character varying(50),
    round_started boolean DEFAULT false,
    round_finished boolean DEFAULT false,
    rolled_back boolean DEFAULT false,
    balance_after numeric(18,8),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support (
    id text NOT NULL,
    user_email text,
    subject text,
    messages jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'open'::text,
    created_date timestamp with time zone DEFAULT now(),
    updated_date timestamp with time zone DEFAULT now(),
    user_name text,
    priority text,
    assigned_to text
);


--
-- Name: tg_auth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_auth_states (
    state text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    done boolean DEFAULT false,
    ref_code text DEFAULT ''::text,
    token text,
    user_data jsonb
);


--
-- Name: ticker_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticker_settings (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    mode text DEFAULT 'wins'::text NOT NULL,
    announcement text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ticker_settings_id_check CHECK ((id = 1))
);


--
-- Name: tx_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tx_idempotency (
    id text NOT NULL,
    reference text NOT NULL,
    user_email text,
    type text,
    amount numeric(20,8),
    balance_after numeric(20,8),
    game_id text,
    game_title text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    role text DEFAULT 'player'::text,
    balance numeric(20,8) DEFAULT 0,
    currency text DEFAULT 'USD'::text,
    preferred_currency text,
    favorite_games jsonb DEFAULT '[]'::jsonb,
    created_date timestamp with time zone DEFAULT now(),
    updated_date timestamp with time zone DEFAULT now(),
    bonus_balance numeric(20,8) DEFAULT 0,
    vip_level integer DEFAULT 0,
    vip_points numeric(20,8) DEFAULT 0,
    total_wagered numeric(20,8) DEFAULT 0,
    wagering_required numeric(20,8) DEFAULT 0,
    wagering_progress numeric(20,8) DEFAULT 0,
    wagering_bonus_amount numeric(20,8) DEFAULT 0,
    bonus_expires_at timestamp with time zone,
    email_verified boolean DEFAULT false,
    email_verification_token text,
    email_verification_expires timestamp with time zone,
    telegram_id text,
    telegram_username text,
    avatar_url text,
    phone text,
    phone_verified boolean DEFAULT false,
    referred_by text,
    affiliate_balance numeric(20,8) DEFAULT 0,
    deposit_limit_daily numeric(20,8),
    deposit_limit_weekly numeric(20,8),
    deposit_limit_monthly numeric(20,8),
    loss_limit_daily numeric(20,8),
    loss_limit_weekly numeric(20,8),
    loss_limit_monthly numeric(20,8),
    wager_limit_daily numeric(20,8),
    session_limit_minutes integer,
    self_excluded_until timestamp with time zone,
    self_excluded_permanent boolean DEFAULT false,
    rg_limit_change_at timestamp with time zone,
    is_super_admin boolean DEFAULT false,
    password_changed_at timestamp with time zone,
    totp_secret text,
    totp_enabled boolean DEFAULT false
);


--
-- Name: visit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_events (
    id integer NOT NULL,
    session_id character varying(64) NOT NULL,
    event_type character varying(50) NOT NULL,
    page text,
    extra jsonb,
    user_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: visit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visit_events_id_seq OWNED BY public.visit_events.id;


--
-- Name: visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visits (
    id integer NOT NULL,
    session_id character varying(64) NOT NULL,
    ip character varying(45),
    user_agent text,
    referrer text,
    landing_page text,
    utm_source character varying(255),
    utm_medium character varying(255),
    utm_campaign character varying(255),
    utm_term character varying(255),
    utm_content character varying(255),
    user_id text,
    country character varying(64),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: visits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visits_id_seq OWNED BY public.visits.id;


--
-- Name: chat_messages_old id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages_old ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: community_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages ALTER COLUMN id SET DEFAULT nextval('public.community_messages_id_seq'::regclass);


--
-- Name: deposit_wallet_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposit_wallet_settings ALTER COLUMN id SET DEFAULT nextval('public.deposit_wallet_settings_id_seq'::regclass);


--
-- Name: visit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_events ALTER COLUMN id SET DEFAULT nextval('public.visit_events_id_seq'::regclass);


--
-- Name: visits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits ALTER COLUMN id SET DEFAULT nextval('public.visits_id_seq'::regclass);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: affiliate_accounts affiliate_accounts_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_accounts
    ADD CONSTRAINT affiliate_accounts_email_key UNIQUE (email);


--
-- Name: affiliate_accounts affiliate_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_accounts
    ADD CONSTRAINT affiliate_accounts_pkey PRIMARY KEY (id);


--
-- Name: affiliate_clicks affiliate_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_pkey PRIMARY KEY (id);


--
-- Name: affiliate_commissions affiliate_commissions_affiliate_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_commissions
    ADD CONSTRAINT affiliate_commissions_affiliate_id_period_start_key UNIQUE (affiliate_id, period_start);


--
-- Name: affiliate_commissions affiliate_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_commissions
    ADD CONSTRAINT affiliate_commissions_pkey PRIMARY KEY (id);


--
-- Name: affiliate_earnings affiliate_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_earnings
    ADD CONSTRAINT affiliate_earnings_pkey PRIMARY KEY (id);


--
-- Name: affiliate_events_ledger affiliate_events_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_events_ledger
    ADD CONSTRAINT affiliate_events_ledger_pkey PRIMARY KEY (id);


--
-- Name: affiliate_events_ledger affiliate_events_ledger_type_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_events_ledger
    ADD CONSTRAINT affiliate_events_ledger_type_external_id_key UNIQUE (type, external_id);


--
-- Name: affiliate_player_daily_ngr affiliate_player_daily_ngr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_player_daily_ngr
    ADD CONSTRAINT affiliate_player_daily_ngr_pkey PRIMARY KEY (date, player_id);


--
-- Name: affiliate_referrals affiliate_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_referrals
    ADD CONSTRAINT affiliate_referrals_pkey PRIMARY KEY (id);


--
-- Name: affiliates affiliates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_pkey PRIMARY KEY (id);


--
-- Name: affiliates affiliates_ref_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_ref_code_key UNIQUE (ref_code);


--
-- Name: banner_slides banner_slides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banner_slides
    ADD CONSTRAINT banner_slides_pkey PRIMARY KEY (id);


--
-- Name: chat_messages_old chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages_old
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey1 PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: community_messages community_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_messages
    ADD CONSTRAINT community_messages_pkey PRIMARY KEY (id);


--
-- Name: crypto_addresses crypto_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crypto_addresses
    ADD CONSTRAINT crypto_addresses_pkey PRIMARY KEY (id);


--
-- Name: crypto_addresses crypto_addresses_user_id_chain_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crypto_addresses
    ADD CONSTRAINT crypto_addresses_user_id_chain_token_key UNIQUE (user_id, chain, token);


--
-- Name: crypto_withdrawals crypto_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crypto_withdrawals
    ADD CONSTRAINT crypto_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: deposit_wallet_settings deposit_wallet_settings_chain_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposit_wallet_settings
    ADD CONSTRAINT deposit_wallet_settings_chain_token_key UNIQUE (chain, token);


--
-- Name: deposit_wallet_settings deposit_wallet_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposit_wallet_settings
    ADD CONSTRAINT deposit_wallet_settings_pkey PRIMARY KEY (id);


--
-- Name: game_providers game_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_providers
    ADD CONSTRAINT game_providers_pkey PRIMARY KEY (id);


--
-- Name: game_sessions game_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: invalidated_tokens invalidated_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invalidated_tokens
    ADD CONSTRAINT invalidated_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: jackpot jackpot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jackpot
    ADD CONSTRAINT jackpot_pkey PRIMARY KEY (id);


--
-- Name: jackpot_winners jackpot_winners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jackpot_winners
    ADD CONSTRAINT jackpot_winners_pkey PRIMARY KEY (id);


--
-- Name: operator_messages operator_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_messages
    ADD CONSTRAINT operator_messages_pkey PRIMARY KEY (id);


--
-- Name: operator_players operator_players_operator_id_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_players
    ADD CONSTRAINT operator_players_operator_id_username_key UNIQUE (operator_id, username);


--
-- Name: operator_players operator_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_players
    ADD CONSTRAINT operator_players_pkey PRIMARY KEY (id);


--
-- Name: operator_providers operator_providers_operator_id_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_providers
    ADD CONSTRAINT operator_providers_operator_id_provider_id_key UNIQUE (operator_id, provider_id);


--
-- Name: operator_providers operator_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_providers
    ADD CONSTRAINT operator_providers_pkey PRIMARY KEY (id);


--
-- Name: operator_transactions operator_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_transactions
    ADD CONSTRAINT operator_transactions_pkey PRIMARY KEY (id);


--
-- Name: operators operators_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_email_key UNIQUE (email);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (id);


--
-- Name: operators operators_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_username_key UNIQUE (username);


--
-- Name: promotion_claims promotion_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_claims
    ADD CONSTRAINT promotion_claims_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: rg_daily_stats rg_daily_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rg_daily_stats
    ADD CONSTRAINT rg_daily_stats_pkey PRIMARY KEY (user_id, date);


--
-- Name: rgs_sessions rgs_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rgs_sessions
    ADD CONSTRAINT rgs_sessions_pkey PRIMARY KEY (id);


--
-- Name: rgs_sessions rgs_sessions_player_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rgs_sessions
    ADD CONSTRAINT rgs_sessions_player_token_key UNIQUE (player_token);


--
-- Name: rgs_sessions rgs_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rgs_sessions
    ADD CONSTRAINT rgs_sessions_session_id_key UNIQUE (session_id);


--
-- Name: rgs_transactions rgs_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rgs_transactions
    ADD CONSTRAINT rgs_transactions_pkey PRIMARY KEY (id);


--
-- Name: rgs_transactions rgs_transactions_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rgs_transactions
    ADD CONSTRAINT rgs_transactions_transaction_id_key UNIQUE (transaction_id);


--
-- Name: support support_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support
    ADD CONSTRAINT support_pkey PRIMARY KEY (id);


--
-- Name: tg_auth_states tg_auth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_auth_states
    ADD CONSTRAINT tg_auth_states_pkey PRIMARY KEY (state);


--
-- Name: ticker_settings ticker_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticker_settings
    ADD CONSTRAINT ticker_settings_pkey PRIMARY KEY (id);


--
-- Name: tx_idempotency tx_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_idempotency
    ADD CONSTRAINT tx_idempotency_pkey PRIMARY KEY (id);


--
-- Name: tx_idempotency tx_idempotency_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_idempotency
    ADD CONSTRAINT tx_idempotency_reference_key UNIQUE (reference);


--
-- Name: promotion_claims uq_promotion_claims_user_promo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_claims
    ADD CONSTRAINT uq_promotion_claims_user_promo UNIQUE (user_id, promotion_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visit_events visit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_events
    ADD CONSTRAINT visit_events_pkey PRIMARY KEY (id);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: idx_ael_affiliate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ael_affiliate ON public.affiliate_events_ledger USING btree (affiliate_id);


--
-- Name: idx_ael_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ael_occurred ON public.affiliate_events_ledger USING btree (occurred_at);


--
-- Name: idx_ael_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ael_player ON public.affiliate_events_ledger USING btree (player_id);


--
-- Name: idx_ael_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ael_type ON public.affiliate_events_ledger USING btree (type);


--
-- Name: idx_aff_accounts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_accounts_email ON public.affiliate_accounts USING btree (email);


--
-- Name: idx_aff_clicks_aff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_clicks_aff ON public.affiliate_clicks USING btree (affiliate_id);


--
-- Name: idx_aff_clicks_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_clicks_created ON public.affiliate_clicks USING btree (created_at);


--
-- Name: idx_aff_clicks_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_clicks_ref ON public.affiliate_clicks USING btree (ref_code);


--
-- Name: idx_aff_comm_affiliate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_comm_affiliate ON public.affiliate_commissions USING btree (affiliate_id);


--
-- Name: idx_aff_comm_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aff_comm_status ON public.affiliate_commissions USING btree (status);


--
-- Name: idx_affiliate_referrals_affiliate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliate_referrals_affiliate ON public.affiliate_referrals USING btree (affiliate_id);


--
-- Name: idx_affiliates_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliates_account_id ON public.affiliates USING btree (account_id);


--
-- Name: idx_affiliates_ref_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_affiliates_ref_code ON public.affiliates USING btree (ref_code);


--
-- Name: idx_apdn_affiliate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apdn_affiliate ON public.affiliate_player_daily_ngr USING btree (affiliate_id);


--
-- Name: idx_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_admin ON public.admin_audit_log USING btree (admin_id);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.admin_audit_log USING btree (created_at DESC);


--
-- Name: idx_chat_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session ON public.chat_messages USING btree (session_id, created_at);


--
-- Name: idx_chat_sessions_last; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_last ON public.chat_sessions USING btree (last_message_at DESC);


--
-- Name: idx_chat_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_status ON public.chat_sessions USING btree (status, last_message_at DESC);


--
-- Name: idx_community_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_messages_created ON public.community_messages USING btree (created_at DESC);


--
-- Name: idx_crypto_addresses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crypto_addresses_user ON public.crypto_addresses USING btree (user_id);


--
-- Name: idx_crypto_withdrawals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crypto_withdrawals_status ON public.crypto_withdrawals USING btree (status);


--
-- Name: idx_crypto_withdrawals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crypto_withdrawals_user ON public.crypto_withdrawals USING btree (user_id);


--
-- Name: idx_game_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_user ON public.game_sessions USING btree (user_id);


--
-- Name: idx_games_game_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_games_game_id ON public.games USING btree (game_id) WHERE (game_id IS NOT NULL);


--
-- Name: idx_games_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_provider ON public.games USING btree (provider);


--
-- Name: idx_games_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_games_sort_order ON public.games USING btree (sort_order DESC, created_date DESC);


--
-- Name: idx_inv_tokens_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_tokens_exp ON public.invalidated_tokens USING btree (expires_at);


--
-- Name: idx_op_msg_op_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_msg_op_id ON public.operator_messages USING btree (operator_id);


--
-- Name: idx_op_players_op; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_players_op ON public.operator_players USING btree (operator_id);


--
-- Name: idx_op_prov_op; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_prov_op ON public.operator_providers USING btree (operator_id);


--
-- Name: idx_op_tx_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_tx_created ON public.operator_transactions USING btree (created_at);


--
-- Name: idx_op_tx_op; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_tx_op ON public.operator_transactions USING btree (operator_id);


--
-- Name: idx_operators_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operators_status ON public.operators USING btree (status);


--
-- Name: idx_promotion_claims_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotion_claims_user ON public.promotion_claims USING btree (user_id);


--
-- Name: idx_rgs_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rgs_sessions_token ON public.rgs_sessions USING btree (player_token);


--
-- Name: idx_rgs_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rgs_sessions_user ON public.rgs_sessions USING btree (user_id);


--
-- Name: idx_rgs_tx_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rgs_tx_round ON public.rgs_transactions USING btree (round_id);


--
-- Name: idx_rgs_tx_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rgs_tx_session ON public.rgs_transactions USING btree (session_id);


--
-- Name: idx_tg_auth_states_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_auth_states_created ON public.tg_auth_states USING btree (created_at);


--
-- Name: idx_tx_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_ref ON public.tx_idempotency USING btree (reference);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone);


--
-- Name: idx_users_telegram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_telegram ON public.users USING btree (telegram_id);


--
-- Name: idx_vevents_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vevents_created ON public.visit_events USING btree (created_at);


--
-- Name: idx_vevents_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vevents_session ON public.visit_events USING btree (session_id);


--
-- Name: idx_vevents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vevents_type ON public.visit_events USING btree (event_type);


--
-- Name: idx_visits_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_created ON public.visits USING btree (created_at);


--
-- Name: idx_visits_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_session ON public.visits USING btree (session_id);


--
-- Name: idx_visits_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_user_id ON public.visits USING btree (user_id);


--
-- Name: idx_visits_utm_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_utm_source ON public.visits USING btree (utm_source);


--
-- Name: affiliate_clicks affiliate_clicks_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_clicks
    ADD CONSTRAINT affiliate_clicks_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id);


--
-- Name: affiliate_commissions affiliate_commissions_affiliate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_commissions
    ADD CONSTRAINT affiliate_commissions_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id);


--
-- Name: affiliates affiliates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliates
    ADD CONSTRAINT affiliates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crypto_addresses crypto_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crypto_addresses
    ADD CONSTRAINT crypto_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: crypto_withdrawals crypto_withdrawals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crypto_withdrawals
    ADD CONSTRAINT crypto_withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: game_sessions game_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: operator_messages operator_messages_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_messages
    ADD CONSTRAINT operator_messages_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE CASCADE;


--
-- Name: operator_players operator_players_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_players
    ADD CONSTRAINT operator_players_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE CASCADE;


--
-- Name: operator_providers operator_providers_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_providers
    ADD CONSTRAINT operator_providers_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE CASCADE;


--
-- Name: operator_transactions operator_transactions_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_transactions
    ADD CONSTRAINT operator_transactions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE CASCADE;


--
-- Name: operator_transactions operator_transactions_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_transactions
    ADD CONSTRAINT operator_transactions_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.operator_players(id) ON DELETE SET NULL;


--
-- Name: promotion_claims promotion_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_claims
    ADD CONSTRAINT promotion_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: visits visits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict lUyedrhnPehiGzXlPDomUZGA6LWFhwPDXigsGzuPa3mAIP3rFPiuSFDGukd2bhP

