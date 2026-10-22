create table users (
    id uuid primary key,
    email varchar(254) not null unique,
    status varchar(16) not null default 'active',
    consent_version varchar(16),
    consented_at timestamptz,
    deletion_requested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table otp_codes (
    id uuid primary key,
    email varchar(254) not null,
    code_hash varchar(64) not null,
    expires_at timestamptz not null,
    attempts int not null default 0,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);
create index otp_codes_email_created_idx on otp_codes (email, created_at desc);

create table refresh_tokens (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    token_hash varchar(64) not null unique,
    family_id uuid not null,
    device varchar(60),
    expires_at timestamptz not null,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);
