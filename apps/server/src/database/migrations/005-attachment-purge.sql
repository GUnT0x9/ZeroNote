-- Keep identifiers and replay hashes after bytes are permanently removed.
ALTER TABLE attachments ADD COLUMN purged_at timestamptz;
ALTER TABLE attachments DROP CONSTRAINT attachments_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_payload_size CHECK (
  (purged_at IS NULL AND octet_length(data)=size)
  OR (purged_at IS NOT NULL AND octet_length(data)=0)
);
