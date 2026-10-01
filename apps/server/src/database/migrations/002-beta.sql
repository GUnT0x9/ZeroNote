CREATE TABLE beta_codes (id uuid PRIMARY KEY, secret_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, redeemed_device_id uuid REFERENCES devices(id), redeemed_at timestamptz);
CREATE TABLE beta_devices (device_id uuid PRIMARY KEY REFERENCES devices(id), code_id uuid NOT NULL REFERENCES beta_codes(id));
ALTER TABLE workspaces ADD COLUMN beta_code_id uuid REFERENCES beta_codes(id);
ALTER TABLE document_checkpoints ADD COLUMN through_update_id bigint NOT NULL DEFAULT 0;
-- Alpha checkpoints could contain uncommitted room changes. Rebuild from committed logs.
DELETE FROM document_checkpoints;
CREATE TABLE document_operations (operation_id uuid PRIMARY KEY, page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE, payload_hash text NOT NULL);
INSERT INTO document_operations SELECT operation_id,page_id,encode(sha256(data),'hex') FROM document_updates;
CREATE TABLE document_snapshots (id uuid PRIMARY KEY, page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE, creator_device_id uuid REFERENCES devices(id), kind text NOT NULL CHECK(kind IN ('manual','automatic')), name text NOT NULL DEFAULT '', schema_version integer NOT NULL DEFAULT 1, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), automatic_day date);
CREATE UNIQUE INDEX snapshots_daily ON document_snapshots(page_id,automatic_day) WHERE kind='automatic';
CREATE INDEX snapshots_page ON document_snapshots(page_id,created_at DESC);
CREATE TABLE snapshot_operations (operation_id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), snapshot_id uuid, action text NOT NULL, result jsonb NOT NULL);
