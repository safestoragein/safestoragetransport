-- SafeStorage Transport — 03_expose_schema.sql
-- Run in the Supabase SQL Editor IF the dashboard "Exposed schemas" toggle did not take effect.
-- This sets PostgREST's served schemas directly (in-database config) and keeps everything in
-- the `safestorage` schema — no public tables/views needed.
--
-- NOTE: keep the schemas that are already exposed on your project (public, graphql_public,
-- janakiram_hotel_app) so the other app keeps working, and add safestorage.

alter role authenticator set pgrst.db_schemas to 'public, graphql_public, janakiram_hotel_app, safestorage';

-- make sure the API roles can use the schema + read the table (writes use service_role)
grant usage on schema safestorage to anon, authenticated, service_role;
grant all    on table  safestorage.vendors to service_role;
grant select on table  safestorage.vendors to anon, authenticated;

-- tell PostgREST to reload its config immediately
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
