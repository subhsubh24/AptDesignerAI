# Email welcome sequence — AptDesignerAI waitlist

Staged drafts for the waitlist welcome sequence. **Do not send until the owner connects the email platform (e.g. Mailchimp, Resend, Loops) and approves the content.** These are templates — update placeholder URLs and dates before activating.

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

**Preview text:** iOS App Store and Google Play links, plus a 30% discount for early access.

---

Hi,

Launch is getting close. Here's exactly what to do when we go live:

**On iPhone:** Search "AptDesigner" on the App Store, or tap the link we'll send in the launch email. Download is free.

**On Android:** Same — search on Google Play or use the direct link.

**Your early-access discount:** As a waitlist member, you'll receive a 30% discount code on your first paid plan. We'll include it in the launch email — don't miss it.

**What to have ready:**
- A few photos of the room you want to start with (natural light, no flash)
- Your floor plan if you have one (a photo of the builder's plan works fine)
- 10 minutes

That's it. The app walks you through the rest.

More soon,

— AptDesigner

---

## Email 4 — Launch day (triggered manually when app goes live)

**Subject:** AptDesigner is live — here's your 30% discount

**Preview text:** iOS and Android. Download free, upgrade when you're ready.

---

Hi,

It's here.

**[Download on the App Store →]**
[PLACEHOLDER: insert App Store URL]

**[Download on Google Play →]**
[PLACEHOLDER: insert Google Play URL]

**Your early-access code:** `EARLY30`
Applies to the Apartment plan ($29 → $20.30) or Pro plan ($49/month → $34.30/month). Valid for 72 hours.

**Where to start:**
1. Download and create your account (free)
2. Upload a photo of the room that bothers you most
3. Choose the room type, wait about 30 seconds
4. Read the analysis — it's going to say something true about the room

If you run into anything, reply to this email or visit aptdesigner.app/support.

Thank you for waiting.

— AptDesigner

---

## Notes for owner

- Replace `EARLY30` discount code with your actual Stripe/RevenueCat promotional code before sending Email 4.
- Replace App Store / Play Store placeholder URLs with live links once submitted.
- All four emails should be loaded into your email platform and activated as an automation on waitlist signup (trigger: new row in `waitlist_emails` table, or via webhook from the `POST /api/waitlist` endpoint).
- Recommended platform: Loops, Resend + custom templates, or Mailchimp. The `POST /api/waitlist` endpoint currently only inserts the email — you'll need to connect a webhook or use Supabase Edge Functions to sync signups to your email platform.
