ALTER TABLE document_checkpoints DROP CONSTRAINT document_checkpoints_editor_protocol_check;
ALTER TABLE document_checkpoints ADD CONSTRAINT document_checkpoints_editor_protocol_check CHECK (editor_protocol BETWEEN 1 AND 4);

CREATE TABLE search_documents (
  page_id uuid PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  projection jsonb NOT NULL,
  search_text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_documents_text_idx ON search_documents USING gin(to_tsvector('simple', search_text));
