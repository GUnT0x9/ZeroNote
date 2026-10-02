-- Keep the minimum version monotonic: removing a new block must not let an old
-- offline client replay a deletion against a document it cannot understand.
ALTER TABLE document_checkpoints ADD COLUMN IF NOT EXISTS editor_protocol integer NOT NULL DEFAULT 1 CHECK (editor_protocol BETWEEN 1 AND 2);
