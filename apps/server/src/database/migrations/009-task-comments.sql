ALTER TABLE comments ADD COLUMN IF NOT EXISTS row_id uuid;
CREATE INDEX IF NOT EXISTS comments_scope ON comments(page_id,row_id,created_at,id);
