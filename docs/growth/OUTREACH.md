# Strategic outreach — curated, human-reviewed email drafts (the Growth Agent loop)

A high-leverage channel the Growth Agent MAY run: 1:1, deeply-personalized outreach to a few
genuinely strategic targets — drafted as Gmail DRAFTS for the OWNER to review and send. This is
NOT cold-emailing at scale; it is a handful of researched, high-confidence messages where a reply
is realistically anticipated. Done well it builds press/partnership/community relationships
(especially pre-launch). Done badly it is spam that burns the sending domain and the brand — so
the bar is high and the rails are hard.

## The hard rails (non-negotiable)
- **DRAFT ONLY — the human sends.** The agent creates a Gmail DRAFT and never sends. (The Gmail
  tool is `create_draft`; it cannot send.) The owner reviews, edits, and sends from their own
  mailbox under their own identity. No auto-send, ever.
- **High-confidence + strategic ONLY.** Draft a message ONLY if you can name all three: (a) the
  SPECIFIC real recipient and why THIS person/org (not a generic list entry); (b) the genuine
  reason they'd care; (c) the realistic response you anticipate. If you can't write all three,
  don't draft it. A "maybe they'll reply" is a no.
- **A few per run, max — never a blast.** This is curation, not volume. Some runs produce zero
  outreach drafts, and that's correct. Never generate a batch to look busy; never work from a
  bought/scraped list; never email the same target twice without a real new reason.
- **Real, publicly-appropriate contacts only.** Use WebSearch to find a genuinely strategic target
  AND their PUBLISHED professional contact (a journalist's public press email, a company's
  partnerships@/press@, a creator's listed business email). NEVER invent, guess, or scrape a
  personal email; never harvest PII. If only a contact form exists, draft the message for the
  owner to paste there instead of inventing an address.
- **Honest + compliant.** Every claim TRUE (no invented metrics, traction, or social proof — same
  anti-gaming rule as the business case). Identify who you are, why you're reaching out, and make
  the ask clear; include an easy opt-out / "reply STOP and I won't follow up" line (CAN-SPAM /
  GDPR-clean). On-brand voice per VISION.md.
- **Pre-launch destination = the waitlist.** Any link points to the PUBLIC waitlist / "coming
  soon", never the gated/unfinished app (same posture as every other channel; respects the SITE
  GATE). Post-launch, link to the live product.
- **Maker != checker.** Run an outreach draft through the independent reviewer subagent (on-brand?
  honest? genuinely strategic vs spam? compliant?) before queuing it as a draft, like any
  substantive growth asset.

## Good target types (examples, not a quota)
Journalists/publications who actually cover interior-design / proptech / AI consumer apps;
potential integration or distribution partners (furniture retailers, rental platforms, design
communities); design creators/influencers whose audience overlaps; relevant newsletter curators.
NOT: random businesses, generic "founders," scraped consumer emails, anyone with no real reason
to care.

## The draft format (what the owner receives)
Each outreach item is its own Gmail DRAFT addressed for the owner's review, containing:
1. **Target** — name, org, role, and the PUBLIC contact (or "contact form: <url>" if no email).
2. **Why this target now** — the specific strategic reason + the anticipated response.
3. **Confidence** — high only (if it's not high, you shouldn't be drafting it).
4. **The email** — subject + body, fully personalized, honest, on-brand, with the ask + opt-out.
Record outreach activity in `GROWTH_STATUS.md` (`outreach` block: drafted_7d, owner_sent_7d,
replies_7d, signal) with REAL numbers only, and the durable lessons (what got replies, what didn't)
in `GROWTH_MEMORY.md` so targeting compounds. Replies are owner-reported; never fabricate a reply
or a send.

## Surfacing on the factory dashboard (so the owner sees drafts to review)
The draft CONTENTS live in the owner's Gmail (the dashboard can't read them). Surface the STATUS so
the owner knows to look, two ways:
- **OWNER_ACTIONS (primary — the dashboard already renders this):** whenever there are outreach
  drafts awaiting the owner, record/refresh ONE item in `PENDING_OPS.md` OWNER_ACTIONS, e.g.
  `id: review-outreach-drafts`, `title: "Review + send N strategic outreach drafts (Gmail)"`,
  `priority: normal`, `status: open`, with the count + a one-line who/why. Decrement/close it as the
  owner sends; never leave a stale count. Honest counts only.
- **GROWTH_STATUS `outreach` block:** keep `drafted_7d / owner_sent_7d / replies_7d / signal`
  current with REAL numbers (replies owner-reported) so the dashboard can show an outreach tile.

## When NOT to do outreach
If there's no genuinely strategic, researchable target this run — or pre-launch with the SITE GATE
not up and nothing the owner has asked to tee up — do NONE. A quiet run with zero outreach drafts
is a success; a pile of generic cold drafts is a failure.
