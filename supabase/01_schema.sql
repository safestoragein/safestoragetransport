-- SafeStorage Transport — 01_schema.sql   (run FIRST in Supabase → SQL Editor)
-- Everything lives in a dedicated "safestorage" schema.
-- One comprehensive vendor table: pricing/tier (from the Excel) + operational details
-- (contacts, supervisor, driver, packers, vehicle) from the teams/vehicles tabs.

create extension if not exists pgcrypto;          -- for gen_random_uuid()
create schema if not exists safestorage;

create table if not exists safestorage.vendors (
  id                  uuid primary key default gen_random_uuid(),

  -- ── identity & vehicle (Excel) ──────────────────────────────────────────────
  city                text not null,
  name                text not null,
  vehicle_type        text not null check (vehicle_type in ('10ft','14ft','others')),
  pallet_capacity     numeric(4,1) not null,            -- 10ft = 4, 14ft = 7, others = 7
  effective_capacity  numeric(4,1) not null,            -- with overage tolerance: 4.2 / 7.5 / 7.5

  -- ── tier & pricing (Excel) ──────────────────────────────────────────────────
  -- general (10ft/14ft): we pay the daily_price (>= 7 pallets) whether or not we give orders.
  -- non_general (others): premium / transaction pricing, used only when needed.
  tier                text not null default 'general' check (tier in ('general','non_general')),
  daily_price         numeric(10,2),                    -- general: guaranteed ₹/day
  pricing_note        text,                             -- non_general: e.g. '6 transactions / ₹20,000'
  per_transaction     numeric(10,2),                    -- derived per-transaction rate

  -- ── location ────────────────────────────────────────────────────────────────
  starting_point      text,                             -- depot locality
  starting_lat        double precision,                 -- geocoded (approx; refine anytime)
  starting_lng        double precision,

  -- ── classification ─────────────────────────────────────────────────────────
  is_intercity_vendor boolean not null default false,   -- can take intercity / long-haul jobs

  -- ── operational details (teams / vehicles tabs) ─────────────────────────────
  system_team_id      text,                             -- main_team_id in the live system (link key)
  system_team_no      text,                             -- the team label shown in the app
  vehicle_no          text,                             -- registration number
  vehicle_name        text,
  driver_name         text,
  driver_contact      text,
  supervisor_name     text,
  supervisor_contact  text,
  packer_names        text,
  team_working_status text,

  -- ── meta ────────────────────────────────────────────────────────────────────
  remarks             text,
  active              boolean not null default true,
  source              text not null default 'panel',    -- 'excel' = seed, 'panel' = added in app
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (city, name, vehicle_type)                     -- lets the seed re-run safely
);

create index if not exists idx_vendors_city      on safestorage.vendors (city)               where active;
create index if not exists idx_vendors_tier      on safestorage.vendors (tier)               where active;
create index if not exists idx_vendors_intercity on safestorage.vendors (is_intercity_vendor) where active;

create or replace function safestorage.set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_vendors_updated on safestorage.vendors;
create trigger trg_vendors_updated before update on safestorage.vendors
  for each row execute function safestorage.set_updated_at();

-- Read for anyone; writes come from the app server using the SERVICE ROLE key (bypasses RLS).
alter table safestorage.vendors enable row level security;
drop policy if exists vendors_read on safestorage.vendors;
create policy vendors_read on safestorage.vendors for select using (true);

-- IMPORTANT (Supabase): expose the schema to the API so the JS client can reach it.
-- Dashboard → Settings → API → "Exposed schemas" → add  safestorage
-- (or run the line below, then reload the API):
grant usage on schema safestorage to anon, authenticated, service_role;
grant select on safestorage.vendors to anon, authenticated;
grant all on safestorage.vendors to service_role;
