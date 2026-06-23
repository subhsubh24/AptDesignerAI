-- Add public sharing support to saved_designs.
-- Users can generate a share token that lets anyone view their design without
-- an account. The share token is a random 32-char hex string; disabling sharing
-- does NOT rotate the token, so the same URL can be re-enabled.
ALTER TABLE saved_designs
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS saved_designs_share_token_idx
  ON saved_designs (share_token)
  WHERE share_token IS NOT NULL;

-- Allow unauthenticated reads of public designs via share token.
-- RLS already restricts everything else to the owning user_id.
CREATE POLICY "Public can view shared designs"
  ON saved_designs FOR SELECT
  USING (is_public = true);
