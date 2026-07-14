# Routines — orchestration as factory-as-code

Version-controlled manifest of the autonomous routines that operate on
AptDesignerAI, per **FACTORY_STANDARD §49**. This file is the **source of truth**;
the runner (claude.ai code triggers) config must match it. Reconcile against the
RemoteTrigger API each cycle — drift is a finding to file, not silently accepted.
**Never fabricate routine state:** a routine the API doesn't return is marked
`UNRECONCILED`, never omitted or invented (§17).

Cron is UTC. `mcps` = the MCP connections attached to that routine.

## Routines operating on AptDesignerAI

### Product build factory — the maker loop
- **id:** `UNRECONCILED` — not returned by the RemoteTrigger `list` API (it is
  paginated / workspace-scoped and the build factories fall on a page the tool
  won't page to). Capture id / cron / env / prompt / mcps from claude.ai and fill
  this in, then delete this note.
- **role:** autonomous build loop — ships product changes each run (maker ≠
  checker §4, readiness gate §7, live-prod validation §44). Runs ~3×/day (8h).
- **expected mcps:** Gmail (notify) · **Mobbin** (design grounding §6b — the
  connector `950dccfd-90e3-45b2-b7c2-f8bcd3f2b76c` is real and already attached to
  the auditors, so wiring it here is a one-shot config change once the id is known)
  · **a browser** (§44 Layer-B live-prod vision pass). ⚠️ **VERIFY** — no routine
  the API returns has a browser MCP yet.

### Quality Auditor — the independent checker (maker ≠ checker twin)
- **id:** `trig_01Hiu9iTrqgMzQWdPQuFZEdG`
- **cron:** `30 9 * * 1` — **weekly**, Mondays 09:30 UTC (moved from every-2-days
  on 2026-07-14: the build factory ships ~3×/day, so a weekly audit still batches
  ~21 build-runs; ~71% fewer auditor runs at no real loss — §47 efficiency) ·
  **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Gmail`, `Mobbin`
- **role:** independent adversarial quality grader → writes `QUALITY_SCORECARD.md`.
- **gap:** has Mobbin (§6b design-reference grounding ✓) but **no browser MCP**, so
  §44 Layer-B live-prod vision review still can't run here. Attach a browser to
  enable, or file the gap.

### GTM Auditor — independent grader of the GTM Factory
- **id:** `trig_01EQkT44rW5guBG42VEPjw9M`
- **cron:** `30 3 * * 1` — **weekly**, Mondays 03:30 UTC (kept weekly on
  2026-07-14: GTM factories run ~every 2 days, so weekly already batches ~3–4 GTM
  runs; the metric-integrity / business-case-honesty / compliance stakes argue
  against bi-weekly) · **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Google_Drive`, `Gmail`, `Google_Calendar`, `Mobbin`
- **role:** independent GTM/growth grader → writes `GTM_SCORECARD.md`.

### Fleet stuck-PR janitor — fleet-wide (incl. AptDesignerAI)
- **id:** `trig_01EQZG8cVLFx7KPuhRSqx6Vk`
- **cron:** `37 */12 * * *` — every 12h UTC (kept frequent: it unblocks stuck PRs;
  slowing it could block a repo's merges for days) · **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Google_Drive`, `Gmail`, `Claude_Code_Remote`

## Fleet-wide cadence note (2026-07-14)
All 5 products' **Quality Auditors** moved every-2-days → **weekly, staggered** so
they don't all fire the same day: Apt Mon · Grocery Tue · Highlight Wed · Job Thu ·
LLM-Quant Fri. GTM Auditors kept **weekly**. Product build factories unchanged
(~3×/day). Mobbin (`950dccfd-…`) verified attached to all 5 Quality Auditors and
the Apt GTM Auditor.

## Reconcile checklist (run each cycle — §49)
- [ ] Every routine above still exists in the runner with matching cron / env / mcps.
- [ ] The **build factory's** real config is captured (remove `UNRECONCILED`).
- [x] Mobbin (§6b) attached to the Quality + GTM Auditors — done 2026-07-14.
- [ ] A **browser** MCP (§44 Layer-B live-prod vision) is attached to the
      design-doing routines (build factory, Quality Auditor) — still missing on
      every routine.
- [ ] Any orchestration change was made as a **diff to this file** + owner-approved
      (§38), not via an opaque UI edit.

---

*Last reconciled 2026-07-14 (20 of N routines returned by the API; the product
build factories remain `UNRECONCILED` pending capture from claude.ai). This is the
honest, versioned source of truth per §49 — not yet a complete census.*
