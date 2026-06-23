# Improvement Log

One line per autonomous loop run. Most recent first.

| Date | Area | Change | Outcome |
|------|------|--------|---------|
| 2026-06-23 | Feature / Social / SEO | Add OG + Twitter Card meta tags to `/shared/[token]`: convert page from client-side fetch to server component with `generateMetadata()` (dynamic title/description/image per design); `not-found.tsx` for HTTP 404; `loading.tsx` for navigation state; zero new LLM calls | PR #6 (auto-merge enabled) |
| 2026-06-23 | Feature / Retention | Add public share links for saved designs: PATCH `/api/saved-designs/[id]` generates a 128-bit share token; public `GET /api/shared/[token]` endpoint (no auth); public `/shared/[token]` editorial page with CTA; share toggle UI in saved design detail page; DB migration for real Supabase | PR #5 (auto-merge enabled) |
| 2026-06-23 | Engineering quality | Add 66 tests for `product-math.ts` + `material-math.ts`: 6-axis product scoring (scale/palette/material/value/proportion/lifestyle), wood coherence, metal coherence, soft-hard ratio, distribution balance, cross-room constraints | PR #3 (auto-merge enabled) |
| 2026-06-23 | Engineering quality | Add 53 tests for `set-math.ts` + `bundle-math.ts`: cross-product coherence, material conflicts, duplicate detection, tier differentiation, spatial feasibility, room completeness, price coherence | PR #2 (auto-merge enabled) |
| 2026-06-23 | Engineering quality | Add 55 tests for `color-math.ts`: CIEDE2000 reference pairs (Sharma 2005) + palette harmony + per-item fit integration | PR #1 (auto-merge enabled) |
