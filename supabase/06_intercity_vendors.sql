-- SafeStorage Transport — 06_intercity_vendors.sql
-- Inserts the 5 intercity / long-haul packers (origin: Bangalore).
-- Modelled as tier 'non_general' + vehicle_type 'others' + is_intercity_vendor = true so they sit
-- apart from the daily general 10ft/14ft teams. Coverage is kept in `remarks`. Pricing is per-trip
-- (TBD) so daily_price is left null. Re-runnable (upserts on the city+name+vehicle_type key).

insert into safestorage.vendors
  (city, name, vehicle_type, pallet_capacity, effective_capacity,
   tier, pricing_note, starting_point, starting_lat, starting_lng,
   is_intercity_vendor, supervisor_name, supervisor_contact, remarks, active, source)
values
  ('Bangalore', 'BRL Packers',     'others', 7, 7.5, 'non_general', 'Intercity — per-trip pricing (TBD)', 'Bangalore', 12.9716, 77.5946, true, 'Sunil',   '9121606001', 'Intercity: all over India',                 true, 'panel'),
  ('Bangalore', 'Best Express',    'others', 7, 7.5, 'non_general', 'Intercity — per-trip pricing (TBD)', 'Bangalore', 12.9716, 77.5946, true, 'Madhan',  '7973183628', 'Intercity: all over India',                 true, 'panel'),
  ('Bangalore', 'Caravan Packers', 'others', 7, 7.5, 'non_general', 'Intercity — per-trip pricing (TBD)', 'Bangalore', 12.9716, 77.5946, true, 'Sandeep', '9379005001', 'Intercity: all over India',                 true, 'panel'),
  ('Bangalore', 'Daksh Packers',   'others', 7, 7.5, 'non_general', 'Intercity — per-trip pricing (TBD)', 'Bangalore', 12.9716, 77.5946, true, 'Ajay',    '9513133001', 'Intercity: from Bangalore, ~300–600 km',    true, 'panel'),
  ('Bangalore', 'Rainbow Packers', 'others', 7, 7.5, 'non_general', 'Intercity — per-trip pricing (TBD)', 'Bangalore', 12.9716, 77.5946, true, 'Rathan',  '9972526164', 'Intercity: from Bangalore, ~300–600 km',    true, 'panel')
on conflict (city, name, vehicle_type) do update set
  tier                = excluded.tier,
  pricing_note        = excluded.pricing_note,
  starting_point      = excluded.starting_point,
  starting_lat        = excluded.starting_lat,
  starting_lng        = excluded.starting_lng,
  is_intercity_vendor = true,
  supervisor_name     = excluded.supervisor_name,
  supervisor_contact  = excluded.supervisor_contact,
  remarks             = excluded.remarks,
  active              = true,
  updated_at          = now();
