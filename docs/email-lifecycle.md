# Email Lifecycle — In-App Users

Complete email sequences for signed-up users across their lifecycle:
activation → habit formation → conversion → win-back.

**Sending engine: code-complete, dry-run until the owner sets credentials.** These
templates send through Resend (`lib/email`, already wired — no Loops/Mailchimp
integration exists or is needed); they stay in dry-run (nothing transmitted) until the
owner sets `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (`PENDING_OPS.md connect-email-resend`).
See "Delivery notes for owner" below for per-sequence trigger status — most sequences
are built and just owner-env-gated; one (Referral/Share) is not yet built at all.
CORRECTED 2026-08-15 (GTM Auditor Run 6, `artifact_freshness`): this banner previously
still said "connect the email platform" and named Loops/Mailchimp as open options,
contradicting the "Delivery notes for owner" section's own correction (Run 15) that
Resend has been wired since before that run.

The waitlist welcome sequence (pre-signup) lives in `docs/email-welcome-sequence.md`.
This file covers everything after account creation.

Tone: calm, informed, specific. Like a knowledgeable friend who happens to have
design school taste. No hype. No emoji in subject lines.

---

## Sequence 1 — New User Activation (Days 0–7 after signup)

Trigger: user signs up but has NOT completed their first room analysis within 24 hours.

### Email A1 — Day 1 (24 hours after signup, no analysis yet)

**Subject:** Ready when you are

**Preview text:** One room, 30 seconds, no credit card.

---

Hi,

Thanks for creating your AptDesigner account.

When you're ready, here's how to get started:

1. Open the app and tap **New Room** (or visit aptdesignerai.com/dashboard)
2. Upload any photo of the room you want to start with
3. Choose the room type
4. Wait about 30 seconds

The app will tell you what the room's light direction implies for your palette, what's
working, what isn't, and what to do about it.

One room is always free. No card, no trial — just the analysis.

[Open AptDesigner →]

— AptDesigner

---

### Email A2 — Day 3 (if still no analysis)

**Subject:** The room that bothers you most

**Preview text:** Start there. It takes 30 seconds.

---

Hi,

There's always one room in an apartment that doesn't quite work. You've rearranged it
twice; it still feels off.

Start with that one.

Upload a photo and AptDesigner will tell you why it feels off — the light direction
your palette is fighting, the scale issue that makes it feel cramped, the material
conflict you didn't notice.

30 seconds to find out what the room needs.

[Start your first analysis →]

---

### Email A3 — Day 7 (if still no analysis — final nudge)

**Subject:** One thing before we stop bothering you

**Preview text:** What would make this actually useful for you?

---

Hi,

You signed up for AptDesigner a week ago and haven't run your first analysis.

That's fine — timing is everything.

Before we reduce how often we email you: is there something in the way? A technical
issue? Not sure what kind of photo works best? Happy to help.

Reply to this email or visit aptdesignerai.com/support.

Otherwise — we'll be here when you're ready.

One room, free, whenever.

[Try it now →]

---

## Sequence 2 — Post-First-Analysis (Habit formation)

Trigger: user completes their first room analysis (milestone event). These emails
run only if the user has NOT upgraded to a paid plan.

### Email B1 — 1 day after first analysis

**Subject:** What the analysis found in your room

**Preview text:** Here's what to look for next.

---

Hi,

You ran your first analysis. Hope it said something useful about the room.

A few things to look for in your results:

**The design direction.** This is the AI's read of where the room wants to go — not
what it currently is, but what it's trying to be. The palette and material
recommendations follow from this.

**The "What to Keep" list.** These are the things already working in your room. Before
you change anything, make sure you're building on these, not painting over them.

**The "What to Remove" list.** The items flagging here are the ones creating conflict —
with the palette, the material story, or the proportion of the room. Not everything on
the list needs to go; it depends on budget and attachment.

Next: if you have more rooms to work on, the Apartment plan covers all of them — $29
one-time. Or keep the single-room free tier as long as you need.

[View your analysis →]

---

### Email B2 — Day 3 after first analysis (if not upgraded)

**Subject:** Your room has a material story

**Preview text:** Here's what that means and why it matters.

---

Hi,

One thing that trips up most apartment redesigns: the material story.

In your analysis, you'll see a list of **Recommended Materials** — these aren't just
textures, they're the material families that belong together. Warm woods (oak, walnut)
pair with warm metals (brass, copper). Cool woods (ash, maple) pair with cool metals
(chrome, steel).

Mixing warm and cool metals in one apartment is one of the most common mistakes the AI
catches. Not fatal — but it's why spaces feel unresolved even when the individual pieces
are beautiful.

If your analysis flagged material conflicts, that's the place to start.

If you want to run the same analysis on your other rooms — to see whether the material
story stays consistent across the apartment — the Apartment plan is $29 one-time.

[See what's consistent across your rooms →]

---

### Email B3 — Day 7 after first analysis (if not upgraded)

**Subject:** The cross-room problem most apartments have

**Preview text:** The bedroom and living room that feel like different places.

---

Hi,

The most common issue AptDesigner finds when it runs across an entire apartment: rooms
that don't share a style thread.

One wood species in the living room, a different one in the bedroom. Warm metals in the
kitchen, cool metals everywhere else. A minimalist bedroom adjacent to a maximalist
living room.

Individual rooms can each "work" and still make the apartment feel incoherent — because
coherence only exists across rooms, not within a single one.

The Apartment plan ($29, one-time) analyses every room in your apartment as part of one
space. The AI tracks your wood species, metal finish, and soft material choices and flags
conflicts before you've bought anything.

If you're designing more than one room, that's where the real value is.

[Unlock the Apartment plan →]

---

## Sequence 3 — Upgrade Conversion

Trigger: user has used their free analysis, hit the paywall (attempted to save a 4th+
design or run an analysis on a second room).

### Email C1 — Same day as paywall hit

**Subject:** Your free analysis is saved

**Preview text:** Ready to do the rest of your apartment?

---

Hi,

You've run a room analysis on AptDesigner. Your results are saved in your account.

The free tier covers one room — your results are yours to keep. Whenever you're ready
to run the next room, the Apartment plan covers everything in one apartment for $29
one-time.

What the Apartment plan includes:
- Every room, unlimited analyses
- Cross-room material and palette coherence tracking
- AI mockups that visualize your room redesigned
- Your designs, saved and accessible from any device

No subscription. Pay once, yours forever.

[Unlock the Apartment plan — $29 →]

---

### Email C2 — Day 2 after paywall

**Subject:** The room you haven't designed yet

**Preview text:** $29 to do the whole apartment.

---

Hi,

If you've been thinking about the next room — the one that also doesn't quite work —
the Apartment plan gets you there.

The $29 is one-time. Not a trial. Not a subscription. You run every room in your
apartment as many times as you want.

If you try it and the analysis doesn't say something useful, email us and we'll refund
it. No form. Just reply to this email.

[Get the Apartment plan →]

---

### Email C3 — Day 5 after paywall

**Subject:** A question about what you're trying to do

**Preview text:** Reply and tell us.

---

Hi,

You ran a room analysis on AptDesigner and haven't upgraded. That's fine — I'm curious
what got in the way.

Was it the price? The rooms you'd want to analyse don't feel worth $29? The analysis
didn't quite land?

Reply and tell me. I read every response. If there's something we can fix, I want to know.

— [Your name]
AptDesigner

---

## Sequence 4 — Engagement / Habit Formation (for paid users)

Trigger: user has upgraded but hasn't logged in for 7 days.

### Email D1 — Day 7 of inactivity (paid user)

**Subject:** Your other rooms

**Preview text:** You've got more space to work on.

---

Hi,

You ran [ROOM TYPE] in AptDesigner a week ago. If there's another room you've been
meaning to tackle — open the app, upload a photo.

The analysis remembers your style thread from the last session. Your new room gets
recommendations that fit the material story you're already building.

[Open AptDesigner →]

*Note: Replace [ROOM TYPE] with the actual room type from the last session if your
email platform supports dynamic merge fields via the Supabase table.*

---

### Email D2 — Day 14 of inactivity (paid user)

**Subject:** Something new in the app

**Preview text:** A quick update from the team.

---

Hi,

A quick update on what's new in AptDesigner:

[Owner: fill in the most recent update — a UI improvement, a new feature, a better
analysis — at the time of sending. Keep it to one sentence. Do not invent updates.]

If you have a room you've been meaning to revisit — or a new one to start — the app
is ready.

[Open AptDesigner →]

---

## Sequence 5 — Win-back (Churned users)

Trigger: user previously paid for a Pro subscription that has now lapsed (subscription_deleted event from RevenueCat / Stripe webhook).

### Email E1 — Day 1 after subscription ends

**Subject:** Your Pro subscription has ended

**Preview text:** Your Apartment analyses are still saved.

---

Hi,

Your AptDesigner Pro subscription ended. Your saved designs and Apartment-plan analyses
are still in your account — nothing is deleted.

If you'd like to continue:
- **Pro plan**: $49/month — unlimited apartments, client-ready share links, priority support
- **Apartment plan**: $29 one-time — your apartment, every room, forever

Or stay on the free tier. Your existing designs stay accessible.

[View your account →]

---

### Email E2 — Day 7 after subscription ends

**Subject:** Still here if you need it

**Preview text:** One room is still free, anytime.

---

Hi,

A week since your Pro subscription ended. Checking in.

If there's something that wasn't working — a feature that didn't meet expectations,
a design output that felt off — I'd like to know. Reply to this email.

If it was just a budget thing: the Apartment plan ($29, one-time) doesn't expire.

[See options →]

---

### Email E3 — Day 30 after subscription ends (final win-back)

**Subject:** Last check-in from AptDesigner

**Preview text:** After this, we'll stop emailing unless you come back.

---

Hi,

It's been a month since your Pro subscription ended. One more note before we reduce
email frequency.

If you're working on an apartment and want to run it through the AI — even just one
room — the free tier is always there.

Thanks for trying Pro.

[Open AptDesigner →]

---

## Sequence 6 — Referral / Share

Trigger: user shares a design (generates a public share link from saved designs).

### Email F1 — Sent 1 hour after first share

**Subject:** Your design is live

**Preview text:** Share the link — anyone can view it.

---

Hi,

You've shared a design from AptDesigner. Here's your link:

[DESIGN_URL]

Anyone with the link can view the design direction, palette, and what the room needs
— without an account.

If they want to run their own room, one analysis is free. No card required.

---

## Delivery notes for owner

CORRECTED Run 15 (GTM Auditor Run 4, artifact_freshness): this section previously described a
pre-engine product ("you'll need to connect a webhook or use Supabase Edge Functions") that no
longer matches what has actually shipped. The sending + trigger engine for Sequences 1, 4, and 5
is CODE-COMPLETE — no webhook/Edge-Function wiring needed for those. What remains is real owner
env-var/migration steps, tracked in `PENDING_OPS.md`, not a build gap:

1. **Email platform: Resend, already wired.** `lib/email` sends through Resend directly (no
   Loops/Mailchimp integration exists or is needed) — dry-run until the owner sets
   `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (`PENDING_OPS.md connect-email-resend`).

2. **Triggers — built, not webhook-driven:**
   - Sequence 1 (Activation A1/A2/A3) and the analogous habit-formation sequence: daily Vercel
     crons (`app/api/cron/activation-emails`, `app/api/cron/habit-emails`, registered in
     `vercel.json`) query signup/activity windows directly — no event-hook wiring needed. Requires
     `CRON_SECRET` + migration 025 (`PENDING_OPS.md set-cron-secret`, `apply-migration-025`).
   - Sequence 5 (Win-back E1/E2/E3): E1 fires directly from the Stripe billing webhook on
     `customer.subscription.deleted` (`app/api/billing/webhook/route.ts`); E2/E3 follow via
     `app/api/cron/winback-emails`.
   - **Sequence 6 (Referral/Share, F1) is NOT yet built** — no `design_shared` trigger or cron
     exists for it. This one genuinely needs the event-hook wiring this section used to describe
     for everything; treat it as a real Product-Factory backlog item, not an owner env-var step.
   - Sequence 3 (upgrade-nudge on repeated `upgrade_page_view` with no conversion) is also not
     wired to a dedicated cron/trigger today — re-verify before promising it fires.

3. **Do not send all sequences at once.** Set up one sequence per week and verify
   deliverability, open rates, and unsubscribe rates before adding the next.

4. **Personalisation placeholders**: `[ROOM TYPE]`, `[DESIGN_URL]`, `[Your name]` —
   replace with merge fields from your email platform or hardcode where dynamic data
   isn't available yet.

5. **Suppression**: All win-back sequences (E1–E3) must respect global unsubscribe.
   Any user who unsubscribes from marketing emails should still receive transactional
   emails (E1 is borderline transactional; E2–E3 are marketing).
