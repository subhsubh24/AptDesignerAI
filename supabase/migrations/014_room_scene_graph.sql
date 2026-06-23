-- ============================================================
-- Multi-view room scene graph
-- ============================================================
--
-- Stores the reconciled, holistic understanding of a room assembled from ALL
-- of its photos at once (lib/agents/scene-assembler.ts +
-- scene-reconciliation.ts): one canonical object per real object, every photo
-- it was seen in linked back to it, the room's spatial layout, and how well the
-- photos cover the space.
--
-- Historically Pass A emitted freeform text, so the same island shot from two
-- angles became two unlinked notes. This column is the deduped, queryable model
-- every downstream stage can read instead of re-deriving from prose.
--
-- Nullable + best-effort: assembly failures never block a diagnosis, and
-- pre-feature rows simply have NULL. Readers MUST treat it as optional.

alter table room_diagnoses
  add column if not exists scene_graph_json jsonb;
