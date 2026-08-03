# Email welcome sequence — AptDesignerAI waitlist

Staged drafts for the waitlist welcome sequence. **CORRECTED (GTM Factory, per GTM Auditor Run 5's
`artifact_freshness` finding): Email 1's send engine is already CODE-COMPLETE, not "do not send
until connected" — `app/api/waitlist/confirm/route.ts` calls `sendEmail()` with the
`waitlist_welcome_1` stage directly on double-opt-in confirmation, no webhook or Edge Function
needed. It ships in dry-run only because `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are unset
(`PENDING_OPS.md connect-email-resend`) — an owner env-var step, not a build gap. See "Notes for
owner" below for what remains unbuilt (Emails 2–4) vs. what is only owner-env-gated (Email 1).
These are templates — update placeholder URLs and dates before activating.

Tone: calm, informed, a little warm. Like a knowledgeable friend who happens to have design school taste. No hype, no emoji.

---

## Email 1 — Day 0 (immediate, on waitlist signup)

**Subject:** You're on the list — here's what's coming

**Preview text:** AptDesigner is almost ready for iOS and Android.

---

Hi there,

Thanks for signing up. You're on the early-access list for AptDesigner — an AI that reads your apartment photos and tells you exactly what to do with them.

Here's what to expect when the app launches:

**On your phone.** Point your camera at any room. In about 30 seconds you'll have a design direction (palette, materials, style notes), a list of what's working and what isn't, and product recommendations scored against your actual space.

**Honest recommendations.** Every furniture pick is scored for scale against your room dimensions, palette compatibility, and style coherence. You see the reasoning, not just a product card.

**The whole apartment.** Design rooms in any order. The AI keeps a shared style thread — so your bedroom doesn't end up looking like a different apartment from your living room.

We'll email you the moment the app is live on the App Store and Google Play.

— The AptDesigner team

---

## Email 2 — Day 3 (three days after signup)

**Subject:** How the AI reads your room

**Preview text:** It's not a mood board generator. Here's what actually happens.

---

Hi,

A quick look at what happens under the hood — because "AI interior design" can mean a lot of things, and most of them are just filtered stock photography.

**What AptDesigner actually does:**

1. **Reads the room.** It analyses light direction, existing finishes, proportions, and traffic patterns from your photos. It doesn't guess at your style — it reads what's already there.

2. **Scores candidates.** Products are pulled from major retailers and scored against six axes: scale fit, palette match, material coherence, lifestyle alignment, value, and proportion. You see the score breakdown for each item.

3. **Reasons across rooms.** If you've designed two rooms already, the AI knows your wood species, metal finish, and soft-material family — and applies that thread to the next room.

4. **Flags conflicts early.** Three wood species in one apartment is a common mistake. The AI catches it before you've bought anything.

The result is a shortlist of things that actually fit your apartment — not a Pinterest board that looks like someone else's house.

See you at launch,

— AptDesigner

---

## Email 3 — Day 7 (one week after signup)

**Subject:** What to look for on launch day

**Preview text:** iOS App Store and Google Play links, plus early-access pricing details.

---

Hi,

Launch is getting close. Here's exactly what to do when we go live:

**On iPhone:** Search "AptDesigner" on the App Store, or tap the link we'll send in the launch email. Download is free.

**On Android:** Same — search on Google Play or use the direct link.

**Your early-access pricing:** As a waitlist member, you'll get early-access pricing on your first paid plan [PLACEHOLDER: the specific offer is not yet finalized — see PENDING_OPS.md `waitlist-early-discount-coupon`; do not send this line until it is decided and a real mechanism exists]. We'll include the details in the launch email — don't miss it.

**What to have ready:**
- A few photos of the room you want to start with (natural light, no flash)
- Your floor plan if you have one (a photo of the builder's plan works fine)
- 10 minutes

That's it. The app walks you through the rest.

More soon,

— AptDesigner

---

## Email 4 — Launch day (triggered manually when app goes live)

**Subject:** AptDesigner is live — here's your early-access discount [PLACEHOLDER: fill in the real % once decided]

**Preview text:** iOS and Android. Download free, upgrade when you're ready.

---

Hi,

It's here.

**[Download on the App Store →]**
[PLACEHOLDER: insert App Store URL]

**[Download on Google Play →]**
[PLACEHOLDER: insert Google Play URL]

**Your early-access code:** `[PLACEHOLDER: no code exists yet — see PENDING_OPS.md `waitlist-early-discount-coupon`. Decide the real discount, create the Stripe coupon, then fill in the code + price math here before sending.]`

**Where to start:**
1. Download and create your account (free)
2. Upload a photo of the room that bothers you most
3. Choose the room type, wait about 30 seconds
4. Read the analysis — it's going to say something true about the room

If you run into anything, reply to this email or visit aptdesignerai.com/support.

Thank you for waiting.

— AptDesigner

---

## Notes for owner

CORRECTED (GTM Factory, per GTM Auditor Run 5, `artifact_freshness`): this section previously
described a pre-engine product for all four emails ("you'll need to connect a webhook or use
Supabase Edge Functions") that no longer matches what has shipped for Email 1. Mirrors the same
correction `docs/email-lifecycle.md` received at Run 15 for its own sequences.

1. **Email 1: sending engine is CODE-COMPLETE, not webhook-gated.** `app/api/waitlist/confirm/route.ts`
   calls `sendEmail()` with the `waitlist_welcome_1` stage directly on double-opt-in confirmation —
   no webhook, no Edge Function, no separate email-platform integration (`lib/email` sends through
   Resend directly). It ships in dry-run only until the owner sets `RESEND_API_KEY` +
   `RESEND_FROM_EMAIL` (`PENDING_OPS.md connect-email-resend`) — an env-var step, not a build gap.
2. **Emails 2–4 are genuinely NOT wired to any trigger.** No cron, webhook, or scheduled job sends
   the Day-3, Day-7, or launch-day emails — `vercel.json`'s only crons are
   `activation-emails`/`habit-emails`/`winback-emails`, all post-signup lifecycle, none waitlist-day-N.
   This is a real Product-Factory backlog item (a day-N waitlist-drip cron reading
   `waitlist_emails.confirmed_at`), not an owner env-var step.
3. Decide the real early-access discount (see `PENDING_OPS.md` `waitlist-early-discount-coupon`), create the Stripe coupon, then fill in the placeholders in Email 3 and Email 4 above with your actual code/percentage before sending.
4. Replace App Store / Play Store placeholder URLs with live links once submitted.
5. Email 4 (launch day) is intentionally manual-trigger, not cron — it should fire once, deliberately, when the owner flips the app live, not on a schedule.
