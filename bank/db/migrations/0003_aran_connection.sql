-- The bank's connection to Aran Cloud, set from the admin-only "Aran connection" page (single row).
-- Both keys are stored encrypted (AES-256-GCM, server-side CONNECTION_ENC_KEY); only the last four characters are kept in clear for display.
-- When no row exists the bank uses ARAN_BASE_URL / ARAN_APP_KEY / ARAN_COMPLIANCE_KEY exactly as before.
create table if not exists core_banking.aran_connection (
  id smallint primary key default 1 check (id = 1),
  base_url text not null,
  app_key_enc text not null,
  compliance_key_enc text not null,
  app_key_last4 text not null,
  compliance_key_last4 text not null,
  workspace_name text,
  status text not null default 'not_connected' check (status in ('connected','not_connected','unreachable','key_rejected')),
  checks jsonb,                       -- result of the last test, per check, plain language, no secrets
  last_checked_at timestamptz,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
alter table core_banking.aran_connection enable row level security;
alter table core_banking.aran_connection force row level security;
