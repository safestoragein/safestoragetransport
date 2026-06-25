-- SafeStorage Transport — 14_vendor_documents.sql
-- Vendor compliance fields: refundable security deposit + two uploaded documents (the files live in
-- Vercel Blob; we store their public URLs here). Re-runnable.
alter table safestorage.vendors
  add column if not exists security_deposit      numeric,
  add column if not exists service_agreement_url text,
  add column if not exists gst_document_url      text;

-- New columns must be visible to the API (PostgREST caches the schema).
notify pgrst, 'reload schema';
