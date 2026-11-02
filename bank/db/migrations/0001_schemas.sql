-- Tessera Bank: five schemas, one per Aran sink. No column stores a raw Aadhaar, card, PAN or mobile:
-- every such column holds an Aran token (or an Aran-redacted text). Staff access goes through server-side code.

create schema if not exists core_banking;   -- sink: kyc-archive
create schema if not exists log_platform;   -- sink: log-platform
create schema if not exists crm;            -- sink: crm
create schema if not exists vendor_share;   -- sink: loan-vendor
create schema if not exists ai_chat;        -- sink: ai-gateway

create sequence if not exists core_banking.customer_ref_seq start 1;
create sequence if not exists core_banking.account_no_seq start 1000001;

create table if not exists core_banking.staff (
  id uuid primary key,                              -- = Supabase auth.users.id
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('kyc_officer','support_agent','compliance_officer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists core_banking.customers (
  id uuid primary key default gen_random_uuid(),
  customer_ref text not null unique,                -- stable key for erasure, e.g. CUS-000123
  name_token text not null,
  mobile_token text not null,
  aadhaar_token text not null,
  pan_token text,
  card_token text,
  status text not null default 'active' check (status in ('active','erased')),
  source text not null default 'branch' check (source in ('branch','portal')),
  created_by uuid references core_banking.staff(id),
  created_at timestamptz not null default now()
);

create table if not exists core_banking.accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references core_banking.customers(id),
  account_no text not null unique,
  type text not null default 'savings' check (type in ('savings','current')),
  balance_paise bigint not null default 0 check (balance_paise >= 0),
  status text not null default 'open' check (status in ('open','frozen','closed')),
  created_at timestamptz not null default now()
);

create table if not exists core_banking.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references core_banking.accounts(id),
  kind text not null check (kind in ('deposit','withdrawal','transfer_in','transfer_out')),
  amount_paise bigint not null check (amount_paise > 0),
  balance_after_paise bigint not null,
  counterparty_account_id uuid references core_banking.accounts(id),
  description text not null default '',             -- passed through Aran (log-platform) before storage
  created_by uuid references core_banking.staff(id),
  created_at timestamptz not null default now()
);
create index if not exists transactions_account_idx on core_banking.transactions(account_id, created_at desc);

create table if not exists core_banking.kyc_cases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references core_banking.customers(id),
  status text not null default 'open' check (status in ('open','approved','rejected')),
  notes text not null default '',                   -- Aran-redacted
  opened_by uuid references core_banking.staff(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists core_banking.reveals (
  id uuid primary key default gen_random_uuid(),
  customer_ref text not null,
  field text not null,
  reason text not null,                             -- Aran-redacted
  staff_id uuid references core_banking.staff(id),
  created_at timestamptz not null default now()
);

create table if not exists core_banking.erasure_requests (
  id uuid primary key default gen_random_uuid(),
  customer_ref text not null,
  purpose text not null,
  requested_by text not null,                       -- staff email or 'customer-portal'
  receipt jsonb,
  created_at timestamptz not null default now()
);

create table if not exists log_platform.app_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  line text not null                                -- Aran-redacted
);

create table if not exists crm.contacts (
  id uuid primary key default gen_random_uuid(),
  customer_ref text not null unique,
  name_token text not null,
  mobile_token text not null,
  created_at timestamptz not null default now()
);
create table if not exists crm.notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id),
  body text not null,                               -- Aran-redacted
  created_by uuid references core_banking.staff(id),
  created_at timestamptz not null default now()
);

create table if not exists vendor_share.loan_leads (
  id uuid primary key default gen_random_uuid(),
  customer_ref text not null unique,
  name_token text not null,
  mobile_token text not null,
  pan_token text,
  loan_amount_paise bigint not null check (loan_amount_paise > 0),
  exported_batch_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists vendor_share.export_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references core_banking.staff(id),
  row_count int not null,
  csv text not null,
  created_at timestamptz not null default now()
);

create table if not exists ai_chat.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_ref text,
  staff_id uuid references core_banking.staff(id),
  provider text not null,
  created_at timestamptz not null default now()
);
create table if not exists ai_chat.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_chat.conversations(id),
  role text not null check (role in ('user','assistant')),
  content text not null,                            -- Aran-redacted (what the provider saw / answered)
  created_at timestamptz not null default now()
);

-- RLS on every table, with no policies: the Supabase client roles (anon, authenticated) can read nothing.
-- The bank's server code connects with a privileged role and enforces roles itself.
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables
           where schemaname in ('core_banking','log_platform','crm','vendor_share','ai_chat') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
    execute format('alter table %I.%I force row level security', r.schemaname, r.tablename);
  end loop;
end $$;
revoke all on all tables in schema core_banking, log_platform, crm, vendor_share, ai_chat from anon, authenticated;
revoke usage on schema core_banking, log_platform, crm, vendor_share, ai_chat from anon, authenticated;
