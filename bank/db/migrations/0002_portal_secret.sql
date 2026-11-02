-- Customers who self-onboard on the portal get a one-time secret (stored only as a SHA-256 hash)
-- so they can later view and erase their own data without a staff login.
alter table core_banking.customers add column if not exists portal_secret_hash text;
