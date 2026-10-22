create table profiles (
    user_id uuid primary key references users (id) on delete cascade,
    income_paise bigint not null check (income_paise > 0),
    savings_paise bigint not null check (savings_paise >= 0),
    payday_rule varchar(20) not null,
    payday_day int check (payday_day between 1 and 28),
    personality varchar(16) not null,
    morning_time time not null,
    night_time time not null,
    timezone varchar(40) not null default 'Asia/Kolkata',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table fixed_costs (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    name varchar(60) not null,
    amount_paise bigint not null check (amount_paise > 0),
    payee_pattern varchar(120),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index fixed_costs_user_active_idx on fixed_costs (user_id) where active;
