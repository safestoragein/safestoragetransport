-- SafeStorage Transport — 16_vendor_billing_cycle.sql
-- How often this vendor is billed/paid: 'daily' | 'weekly' | 'monthly' (null = unset).
alter table safestorage.vendors
  add column if not exists billing_cycle text;

notify pgrst, 'reload schema';
