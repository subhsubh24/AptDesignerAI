# AptDesignerAI — Brand Kit

Reference for the autonomous loop and contributors. Apply consistently across
all surfaces: web, native mobile, store listings, marketing pages, and social.

---

## Name & wordmark

**Full name:** AptDesignerAI  
**Display name (preferred):** AptDesigner  
**Tagline:** *AI-powered interior design.*

The wordmark is a set-weight sans-serif "AptDesigner" followed by a compact
"AI" suffix in the accent colour. It communicates craft + technology without
the fussiness of a decorative logotype. Use the SVG at `public/wordmark.svg`.

**Usage rules**
- Never stretch, rotate, or recolour individual letters.
- Minimum clear space: equal to the height of the "A" on all four sides.
- On dark backgrounds, swap text fill to `#faf9f7`; accent stays `#d4733e`.
- Never pair the wordmark with emoji or decorative flourishes.
- Acceptable pairing: Lucide icons only — not Material, not Hero, not Font Awesome.

---

## Colour palette

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| Background | `#faf9f7` | `#141211` | Page / card backgrounds |
| Text | `#141211` | `#f5f4f2` | Body copy, headings |
| Text Secondary | `#6b6560` | `#9e9893` | Supporting copy, captions |
| Accent | `#b4501e` | `#d4733e` | CTAs, highlights, accent borders |
| Accent Foreground | `#faf9f7` | `#141211` | Text on accent backgrounds |
| Accent (strong text) | `#a3441a` | `#dd8351` | `text-accent-warm-strong` — accent-coloured TEXT on a tinted `bg-accent-warm/N` pill (badges, warm-outline/ghost buttons). Deeper/lighter than the base Accent because it has to clear AA against the tinted surface, not the page background — see `--accent-warm-strong` in `app/globals.css`. |
| Border | `#e8e5e1` | `#2a2724` | Card borders, dividers |
| Card | `#f5f4f2` | `#1e1c1a` | Elevated surfaces |
| Muted Foreground | `#9e9893` | `#706b67` | Placeholder text, quiet labels |
| Background Element | `#eeece9` | `#272420` | Chip backgrounds, secondary fills |
| Background Selected | `#e0ddd9` | `#302d2a` | Selected states |
| Destructive | `#b91c1c` | `#ef4444` | Errors, delete actions |

**Primary palette mnemonic:** warm beige + rust on off-white.  
**Avoid:** cool greys, pure black (`#000`), pure white (`#fff`), electric blues.

---

## Typography

| Role | Spec | Example |
|------|------|---------|
| Display / Title | 28–34 px, weight 700, tight tracking | "Design Analysis" |
| Subtitle | 18–22 px, weight 600 | "Colour Palette" |
| Body (default) | 16 px, weight 400, line-height 24 | Room descriptions |
| Default Semibold | 16 px, weight 600 | Pricing labels, option names |
| Small | 12–13 px, weight 400 | Badges, captions, legal text |

Web stack: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", ...`).  
Native: same system font stack (SF Pro on iOS, Roboto on Android).  
**No custom web fonts** — keeps TTFB fast and avoids a separate CDN dependency.

---

## Spacing system

Built on a 4 px base unit. Named tokens (from `constants/theme.ts`):

| Token | Value |
|-------|-------|
| `Spacing.half` | 2 px |
| `Spacing.one` | 4 px |
| `Spacing.two` | 8 px |
| `Spacing.three` | 16 px |
| `Spacing.four` | 24 px |
| `Spacing.five` | 32 px |
| `Spacing.six` | 64 px |

---

## Brand voice

**Tone:** Calm, informed, a little warm. Like a knowledgeable friend who happens
to have design school taste. Not corporate, not casual-cringe.

- **Do:** "Your living room has strong bones — let's work with the light."
- **Don't:** "🔥 Your room is a vibe! Let's crush this redesign!! 💪"

**Content principles**
1. Ground every recommendation in the actual space. No hallucinated specificity.
2. Be direct. Users are design-literate — don't over-explain.
3. Use metric or imperial consistently within a single design result, never mixed.
4. Never claim "best" / "perfect" / "guaranteed" in store copy — Apple rejects superlatives.

---

## App icon guidance

Style: warm, minimal, editorial. A stylised room corner or furniture silhouette
on the `#b4501e` rust background, white foreground marks, rounded-square
(iOS-style) crop. No text in the icon.

Required sizes (export from SVG master):
- iOS: 1024 × 1024 px PNG (no alpha)
- Android adaptive foreground: 432 × 432 px PNG (within 66 px safe zone)
- Android adaptive background: 432 × 432 px PNG (solid fill or gradient)
- Android monochrome: 432 × 432 px PNG (white on transparent)

Production icons are committed in `mobile/assets/images/` (`icon.png` at
1024×1024, plus the Android adaptive foreground/background/monochrome
variants) — no longer placeholder.

---

## Social & OG assets

| Asset | Dimensions | Notes |
|-------|-----------|-------|
| OG image (web) | 1200 × 630 px | Head meta + share pages; wordmark + tagline on `#faf9f7` bg |
| App Store icon | 1024 × 1024 px | PNG, no alpha |
| Twitter/X avatar | 400 × 400 px | Square crop of wordmark on `#b4501e` bg |
| Instagram avatar | 320 × 320 px | Same as Twitter avatar |

**Wordmark SVG:** `public/wordmark.svg` — use this as the master source for
all exports. Scale uniformly; never rasterise at less than 2× the target size.

---

## Store listing summary (link to full copy)

Full store listing copy (App Store + Google Play) is staged at
`docs/store-listing.md`.

- **App name:** AptDesignerAI (corrected Run 15 — was "AptDesigner — AI Interior Design", which matched neither the canonical `docs/store-listing.md` App Store "Name" field nor the app identity table there)
- **Subtitle (iOS):** AI Interior Design for Any Room
- **Short description (Android):** Photograph any room. Get an AI design plan instantly.
- **Primary keyword cluster:** interior design app, room design AI, home decor planner

---

## What NOT to do

- No emoji as iconography (see VISION.md design bar)
- No skeleton-blue loading spinners — use `colors.accent` (`#b4501e` / `#d4733e`)
- No template-looking cards with blue primary buttons
- No "powered by AI" badges in the UI — the product is the proof
- No fake reviews, fake user testimonials, or invented metrics in any copy
- No unverified superlatives ("world's best", "most accurate") in store copy
