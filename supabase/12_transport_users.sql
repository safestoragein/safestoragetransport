-- SafeStorage Transport — 12_transport_users.sql
-- Per-user login for THIS module only. Deliberately a SEPARATE table from the Agentic CRM's user
-- store — transport staff are managed independently here. Passwords are scrypt-hashed by the app
-- (lib/auth.ts), never stored in plain text. Re-runnable.
create table if not exists safestorage.transport_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,            -- scrypt: "<saltHex>:<hashHex>"
  name          text not null,
  role          text not null default 'staff',   -- 'staff' | 'admin'
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- case-insensitive email lookup
create unique index if not exists transport_users_email_lower_idx
  on safestorage.transport_users (lower(email));

-- The app reads this table with the SERVICE ROLE key only. A table newly created in a custom schema
-- has no grants for Supabase's API roles, so without this the login query fails with
-- "permission denied for table transport_users". Grant ONLY service_role — never anon/authenticated,
-- since this table stores password hashes.
grant all privileges on table safestorage.transport_users to service_role;
notify pgrst, 'reload schema';
