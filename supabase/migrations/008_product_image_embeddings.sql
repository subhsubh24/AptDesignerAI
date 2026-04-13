-- ============================================================
-- product_image_embeddings — vector index for furniture identification
-- ============================================================
--
-- Stores multimodal embeddings (1408-dim, Google `multimodalembedding@001`)
-- of canonical product images + user-confirmed room crops. Used by the
-- furniture identification pipeline (see lib/agents/identified-products-pipeline.ts)
-- to retrieve top-K prior candidates before the Gemini identifier call.
--
-- Seeded by `scripts/seed-product-embeddings.ts` (catalog rows, source="catalog")
-- and grown at runtime by the confirmation endpoint (user-confirmed rows,
-- source="user_confirmed") for the self-learning loop.

create extension if not exists vector;

create table if not exists product_image_embeddings (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  variant text,
  image_url text not null,
  -- 1408 matches Google multimodalembedding@001. If we ever swap the embedding
  -- model, bump this (and the EMBEDDING_DIM constant in lib/ai/embeddings.ts)
  -- together — pgvector will reject inserts of the wrong dimension.
  embedding vector(1408) not null,
  -- Provenance: "catalog" = seeded from a brand's product page, "user_confirmed"
  -- = written back after a positive confirmation on an identified-product entry.
  -- Other values permitted for future expansion (e.g. "admin_seed").
  source text not null default 'catalog',
  created_at timestamptz default now()
);

create index if not exists product_image_embeddings_brand_model_idx
  on product_image_embeddings(brand, model);

create index if not exists product_image_embeddings_source_idx
  on product_image_embeddings(source);

-- ivfflat cosine index. `lists = 100` is a safe default up to ~100k rows;
-- revisit if we index millions of variants. Cosine distance matches how
-- `topKSimilar()` scores in lib/store/embedding-index.ts.
create index if not exists product_image_embeddings_vec_idx
  on product_image_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Row-level security: embeddings are a shared canonical resource (no user_id).
-- Only service-role / server-side callers should write. Reads are public since
-- they're just product image metadata keyed by brand/model.
alter table product_image_embeddings enable row level security;

drop policy if exists product_image_embeddings_read_all on product_image_embeddings;
create policy product_image_embeddings_read_all
  on product_image_embeddings for select
  using (true);

-- No insert/update/delete policies for authenticated users — all writes go
-- through the service role from server routes (confirm endpoint, seed script).
