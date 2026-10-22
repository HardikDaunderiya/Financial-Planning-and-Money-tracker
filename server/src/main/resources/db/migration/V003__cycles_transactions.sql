create table cycles (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    start_date date not null,
    end_date date not null check (end_date >= start_date),
    income_paise bigint,
    savings_paise bigint,
    closed_at timestamptz,
    leftover_paise bigint,
    leftover_choice varchar(16),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, start_date)
);
create index cycles_user_dates_idx on cycles (user_id, start_date, end_date);

create table transactions (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    client_id uuid,
    amount_paise bigint not null check (amount_paise > 0),
    direction varchar(6) not null check (direction in ('debit', 'credit')),
    occurred_at timestamptz not null,
    merchant_name varchar(80),
    merchant_raw_enc bytea,
    category_code varchar(30) not null,
    tag varchar(8),
    payment_method varchar(8) not null,
    source varchar(10) not null,
    status varchar(16) not null,
    counts_in_budget boolean not null default true,
    spread_over_cycle boolean not null default false,
    fixed_cost_id uuid references fixed_costs (id),
    goal_id uuid,
    linked_txn_id uuid references transactions (id),
    import_id uuid,
    fingerprint varchar(64),
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, client_id)
);
create index transactions_user_time_idx on transactions (user_id, occurred_at) where deleted_at is null;
