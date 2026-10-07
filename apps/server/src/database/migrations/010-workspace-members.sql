ALTER TABLE grants ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS member_groups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS member_group_members (
  group_id uuid NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id,identity_id)
);
CREATE TABLE IF NOT EXISTS member_group_grants (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('editor','commenter','viewer')),
  include_descendants boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  UNIQUE(group_id,page_id)
);
CREATE TABLE IF NOT EXISTS member_operations (
  operation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id),
  payload_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS member_groups_workspace ON member_groups(workspace_id);
CREATE INDEX IF NOT EXISTS member_group_identities ON member_group_members(identity_id,group_id);
CREATE INDEX IF NOT EXISTS member_group_page_access ON member_group_grants(page_id,group_id);
