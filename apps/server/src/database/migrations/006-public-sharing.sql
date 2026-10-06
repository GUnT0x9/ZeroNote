CREATE TABLE public_shares (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL,
 title text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('public','temporary','burn')),
 secret_hash text,
 password_hash text,
 expires_at timestamptz,
 seo boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 burned_token_hash text,
 CHECK(NOT seo OR (secret_hash IS NULL AND password_hash IS NULL AND mode='public' AND expires_at IS NULL))
);
CREATE INDEX public_shares_workspace ON public_shares(workspace_id,created_at);
CREATE TABLE public_share_pages (
 share_id uuid NOT NULL REFERENCES public_shares(id) ON DELETE CASCADE,
 page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 public_key uuid NOT NULL,
 position integer NOT NULL,
 PRIMARY KEY(share_id,page_id), UNIQUE(share_id,public_key)
);
CREATE TABLE public_sessions (
 token_hash text PRIMARY KEY,
 share_id uuid NOT NULL REFERENCES public_shares(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 frozen jsonb,
 frozen_files uuid[] NOT NULL DEFAULT '{}',
 UNIQUE(share_id,operation_id)
);
CREATE INDEX public_sessions_share ON public_sessions(share_id,expires_at);
