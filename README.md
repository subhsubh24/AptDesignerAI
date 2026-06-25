# AptDesignerAI

AI-powered interior design for apartments. Upload a photo of your room, describe your style, and get a fully realised design direction with shoppable product picks — in under 10 minutes.

## What it does

- **Room diagnosis** — Gemini analyses your photo to extract room dimensions, existing furniture, dominant palette, and lighting conditions
- **Style direction** — the AI generates a coherent design concept with mood, palette, and material recommendations
- **Shoppable products** — scored and ranked picks from real retailers, matched to your style, budget, and room constraints
- **Share links** — save designs and share a public link with a unique token; only the holder of the token can view the design
- **Mobile companion** — Expo/React Native app for photo capture and on-the-go design review (iOS + Android)

## Stack

| Layer | Technology |
|---|---|
| Web frontend | Next.js 16 App Router, Tailwind CSS |
| Mobile | Expo (React Native) |
| AI pipeline | Google Gemini (room understanding, product scoring) |
| Auth & database | Supabase (Postgres + Row Level Security) |
| Storage | Supabase Storage (room photos) |
| Billing (web) | Stripe |
| Billing (mobile) | RevenueCat |
| Deployment | Vercel (web) + EAS (mobile) |

## Local development

```bash
npm install
npm run dev       # Next.js dev server at http://localhost:3000
npm test          # vitest unit tests
npx tsc --noEmit  # TypeScript check
npx eslint .      # lint
```

The app runs without API keys in local dev — Supabase auth is bypassed when `NEXT_PUBLIC_SUPABASE_URL` is unset, and the AI pipeline is skipped when `GEMINI_API_KEY` is absent.

For the mobile app:
```bash
cd mobile && npm install
npx expo start
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for admin operations |
| `GEMINI_API_KEY` | Google Gemini API key |
| `STRIPE_SECRET_KEY` | Stripe secret key (web billing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `REVENUECAT_SECRET_KEY` | RevenueCat server key (mobile entitlement check) |

See `PENDING_OPS.md` for billing setup steps and Supabase migration instructions.

## Architecture

See `ARCHITECTURE.md` for a full description of the AI pipeline (maker/checker loops, deterministic validators, cost ledger) and `AGENTS.md` for the rules governing AI agent contributions to this repo.
