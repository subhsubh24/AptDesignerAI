# Press Kit + Launch Assets — AptDesignerAI

Ready-to-use launch assets for Product Hunt, journalists, and bloggers.
**Owner: paste and activate; no fabrication, no invented metrics.**

---

## 1. Product Hunt Launch

### Launch day checklist
1. Create a Product Hunt account if you don't have one. A personal account outperforms a brand account for launches.
2. Schedule the post for **12:01 AM PST on launch day** (the start of the Product Hunt day).
3. Embed at least 2 screenshots + 1 short demo video (30–60 seconds of the app flow).
4. Let your network know launch day is happening (e.g. a waitlist email pointing to the live
   Product Hunt post) — do NOT ask anyone to upvote. Product Hunt's guidelines treat solicited
   voting as manipulation and can get a launch penalized or removed; a genuine mention that lets
   people decide for themselves is the compliant version of the same reach.

### Product Hunt tagline (max 60 chars)
```
AI interior design that reads YOUR room, not a mood board
```
*(58 chars)*

### Product Hunt description (max 260 chars)
```
AptDesignerAI photographs your room, understands your light/proportions/finishes, then gives a scored design direction + product picks. Not generic mood boards — your actual space. Free on iOS + Android.
```

### Product Hunt topic tags
- Artificial Intelligence
- Design Tools
- Mobile Apps
- Home Decor
- Productivity

### Product Hunt first comment (from the maker — post immediately on launch)
```
Hey PH! 👋

I built AptDesigner because apartment design advice online is almost entirely aesthetic content — beautiful rooms that look nothing like your 650 sq ft with a north-facing window.

What AptDesigner actually does:
→ Reads your room's light direction, proportions, and existing finishes from your photos
→ Gives a design direction (palette, materials, style) grounded in what's already there
→ Scores furniture recommendations against six axes: scale, palette, material coherence, style, value, proportion

The Apartment plan is $29 one-time — covers every room in your apartment, forever. One room is always free, no card required.

Happy to answer anything about how it works, what it gets wrong, or what we're building next. 🙏
```

---

## 2. Media outreach templates

### Email to interior design bloggers / journalists

**Subject:** AI app that reads your apartment photos — press copy + access

**Body:**
Hi [Name],

I'm reaching out because AptDesignerAI — a new iOS and Android app — launched last
week and I thought your readers might find it worth covering.

**The one-line pitch:** You photograph your room; the AI reads your light direction,
proportions, and existing finishes and gives you a design direction + scored product
recommendations. Not a mood board generator — it actually reads the room you have.

**What makes it different from competitors:**
- Houzz Pro and similar tools are software for professional designers, not apartment renters
- Havenly / Spacejoy use human designers and charge $159–499 per room
- AptDesignerAI is $29 one-time for the whole apartment, with a free single-room tier

**App Store links:**
- iOS: [LINK]
- Android: [LINK]

**Press access:** I'm happy to provide a Pro account for review purposes. Just reply
to this email and I'll set one up.

**Assets:** Screenshots, demo video, and wordmark are at [LINK TO ASSETS FOLDER].

Thanks for your time.

[Name]
AptDesignerAI
[email]

---

### Email to tech journalists (Product Hunt-adjacent beat)

**Subject:** New AI interior design app — $29 one-time vs. Havenly's $499/room model

**Body:**
Hi [Name],

AptDesignerAI launched this week on iOS and Android. The product reads apartment photos
— light direction, proportions, finishes — and outputs a grounded design direction with
scored furniture recommendations.

**The angle that might interest your readers:** The pricing model is a deliberate
contrast to the category. Havenly and Spacejoy charge $159–499 per room for human-
assisted design. AptDesignerAI charges $29 once for the entire apartment — positioning
AI analysis as affordable infrastructure rather than a premium service. Free tier
included (one room, no card).

The scoring system (scale fit, palette match, material coherence, style alignment,
value, proportion) is explained to the user for each product recommendation — the app
shows the reasoning, not just the card.

App Store: [LINK] / Play Store: [LINK]
Happy to do a demo call or provide a review account.

[Name]
[email]

---

## 3. One-pagers / fact sheets

### App facts (verified, no invented metrics)

| Field | Value |
|---|---|
| App name | AptDesignerAI |
| Category | Lifestyle / Utilities |
| Platforms | iOS (App Store) + Android (Google Play) |
| Free tier | 1 full room analysis, no card required |
| Apartment plan | $29 one-time, unlimited rooms in one apartment |
| Pro plan | $49/month, unlimited apartments |
| Analysis time | ~30 seconds per room |
| Inputs accepted | Room photos (camera or gallery), floor plan (optional), free-text notes (optional) |
| AI model | Google Gemini (multimodal) |
| Cross-room coherence | Yes — palette, materials, and style thread across rooms in one apartment |
| Share feature | Yes — generate a public link to share a design card |
| Web companion | Yes — aptdesignerai.com, designs sync |
| Privacy | Photos stored in user account; deleted on account deletion; no data sold |

---

### Boilerplate (for use in descriptions, bylines, About pages)

**Short (25 words):**
AptDesignerAI is an AI interior design app that reads your room photos and returns
a grounded design direction with scored product recommendations.

**Medium (50 words):**
AptDesignerAI turns a photo of any room into a complete interior design plan — curated
palette, material pairings, and scored furniture picks matched to your specific space.
Available on iOS, Android, and web. Apartment plan is $29 one-time; one room is always free.

**Long (100 words):**
AptDesignerAI is an AI interior design copilot for apartments. Users photograph a room
and the app analyzes light direction, proportions, existing finishes, and material
conflicts to produce a grounded design direction — not a generic mood board. Every
product recommendation is scored on six axes: scale fit, palette match, material
coherence, style alignment, value, and proportion. The app handles an entire apartment
as one coherent space, maintaining a shared style thread across rooms. Available on
iOS, Android, and web. The Apartment plan is $29 one-time (unlimited rooms in one
apartment); the Pro plan is $49/month, for professional use.

> **Pro Annual ($399/year) intentionally omitted (2026-07-09)** — same reason as
> `docs/store-listing.md`: the `pro_annual` DB tier constraint (migration 021) is still
> unapplied to prod (`PENDING_OPS.md`, `apply-migration-021`, `status: open`), so it is not
> yet purchasable. Re-add once that migration is confirmed applied.

---

## 4. Media asset directory

**Owner: host these at a shareable URL (Dropbox, Google Drive, or aptdesignerai.com/press) and replace [LINK] below.**

| Asset | Description | Status |
|---|---|---|
| `wordmark.svg` | Official wordmark (see `public/wordmark.svg`) | Ready |
| App icon (1024×1024 PNG) | iOS / Android icon at full resolution | Owner to export |
| Screenshots (6.9" iPhone) | App flow screenshots (6 recommended — see `docs/store-listing.md`) | Owner to capture |
| Screenshots (iPad Pro 13") | Required if iPad support enabled | Owner to capture |
| Screenshots (Android 16:9) | Full-bleed Android screenshots | Owner to capture |
| Demo video (30–60s) | Screen recording of full analysis flow | Owner to record |
| OG image (1200×630) | Social preview card (warm editorial, wordmark, tagline) | DONE — `app/opengraph-image.tsx` + `app/waitlist/opengraph-image.tsx` shipped 2026-07-26 (PR #714); no owner action needed |

Press assets folder (owner creates): [LINK]

---

## 5. Launch day checklist

### 24 hours before launch
- [ ] Load Email 4 (launch announcement) in your email platform, scheduled for 9am
- [ ] Schedule X/Twitter launch thread (see `docs/content-calendar.md` — Day 1)
- [ ] Schedule Instagram launch post (see `docs/content-calendar.md` — Day 1)
- [ ] Prepare Product Hunt post with screenshots + video — publish at 12:01am PST

### Morning of launch
- [ ] Verify App Store / Play Store links are live
- [ ] Post Product Hunt first comment immediately after launch post goes live
- [ ] Send launch email to waitlist
- [ ] Post X/Twitter launch thread
- [ ] Let supporters know the Product Hunt post is live (email / DM a link) — do not ask them to upvote

### During launch day
- [ ] Reply to every Product Hunt comment within 2 hours
- [ ] Reply to every X/Twitter reply and quote-tweet
- [ ] Post Instagram launch Reel (cross-post the TikTok script)
- [ ] Monitor App Store Connect for crashes / review board flags

### End of day
- [ ] Post X/Twitter end-of-day thanks
- [ ] Record downloads, revenue, Product Hunt rank for future reference
- [ ] Reply to any press inquiry emails

---

## 6. Landing page A/B variants

Two headline variants for the `/waitlist` page. Owner tests which converts better.

### Variant A (current — benefit-led)
**Headline:** Design any room with AI
**Subheadline:** Photograph your room. Get a palette, materials, and furniture picks matched to your actual space — not a generic mood board.
**CTA:** Join the waitlist

### Variant B (problem-led)
**Headline:** Your apartment knows what it wants. The AI can read it.
**Subheadline:** Upload a photo. AptDesignerAI analyses your light, proportions, and finishes — and tells you exactly what to change, and what to keep.
**CTA:** Get early access

### Variant C (price-led)
**Headline:** Professional interior design analysis. $29 one-time.
**Subheadline:** Not a subscription. Not a designer. Your whole apartment — every room — analysed by AI for a flat $29. One room is always free.
**CTA:** Try one room free

### Guidance
- Variant B tends to perform better for design-literate audiences (higher engagement, lower CVR)
- Variant C tends to drive higher conversion for price-sensitive segments
- Variant A (current) is the safe default; test B and C after launch when traffic data is available
- Recommended tool: Vercel Edge Config + A/B cookie, or a dedicated tool like Optimizely

---

## Notes for owner

- Never invent download counts, user numbers, or testimonials.
- Press reviews take 1–3 weeks. Send outreach 2 weeks before launch, not the day of.
- Product Hunt ranking is heavily influenced by launch-day traffic and genuine engagement.
  Email your waitlist the morning of launch with the direct PH link so people who want to check
  it out can — but do NOT ask them to upvote or vote-brigade; Product Hunt's guidelines prohibit
  solicited voting and enforce against it.
- The waitlist early-access discount code, once finalized (see `email-welcome-sequence.md` and
  `PENDING_OPS.md` `waitlist-early-discount-coupon` — no real code exists yet), can be offered
  to journalists and bloggers as a review incentive — that's standard practice.
