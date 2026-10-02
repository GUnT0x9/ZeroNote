CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL CHECK(size > 0 AND size <= 4194304),
  payload_hash text NOT NULL,
  data bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK(octet_length(data)=size)
);
CREATE INDEX attachments_page ON attachments(page_id,created_at);
CREATE INDEX attachments_workspace ON attachments(workspace_id);
CREATE TABLE attachment_operations (
  operation_id uuid PRIMARY KEY,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  payload_hash text NOT NULL
);
