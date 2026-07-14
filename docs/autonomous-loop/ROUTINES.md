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
  won't page to). Capture id / cron / env / prompt from claude.ai and fill this in,
  then delete this note.
- **role:** autonomous build loop — ships product changes each run (maker ≠
  checker §4, readiness gate §7, live-prod validation §44). Runs ~3×/day (8h).
- **mcps / browser:** Gmail (notify) · **Mobbin** (§6b design grounding — connector
  `950dccfd-90e3-45b2-b7c2-f8bcd3f2b76c`; **attached to the build factories by the
  owner, 2026-07-14**) · **browser** via **Browserbase credentials in the routine
  env** (owner-confirmed 2026-07-14) — driven with Playwright for §44 Layer-B, NOT
  an MCP connector. `UNRECONCILED` on id/cron/env only until captured.

### Quality Auditor — the independent checker (maker ≠ checker twin)
- **id:** `trig_01Hiu9iTrqgMzQWdPQuFZEdG`
- **cron:** `30 9 * * 1` — **weekly**, Mondays 09:30 UTC (moved from every-2-days
  on 2026-07-14: the build factory ships ~3×/day, so a weekly audit still batches
  ~21 build-runs; ~71% fewer auditor runs at no real loss — §47 efficiency) ·
  **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Gmail`, `Mobbin`
- **role:** independent adversarial quality grader → writes `QUALITY_SCORECARD.md`.
- **browser:** §44 Layer-B live-prod vision is available via the **Browserbase
  credentials in the routine env** (driven with Playwright) — no browser MCP
  connector needed. Combined with Mobbin (§6b ✓), it can now do full design-taste
  grading against both real references and the live app.

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

## Fleet-wide cadence + capability note (2026-07-14)
All 5 products' **Quality Auditors** moved every-2-days → **weekly, staggered** so
they don't all fire the same day: Apt Mon · Grocery Tue · Highlight Wed · Job Thu ·
LLM-Quant Fri. GTM Auditors kept **weekly**. Product build factories unchanged
(~3×/day). Mobbin (`950dccfd-…`) verified attached to all 5 Quality Auditors + the
Apt GTM Auditor, and **attached to the build factories by the owner**. **Browserbase
credentials are provisioned in the cloud routine env** (owner-confirmed), so §44
Layer-B (drive live prod via Playwright → screenshot → multimodal review) can now
run — no browser MCP connector required.

## Reconcile checklist (run each cycle — §49)
- [ ] Every routine above still exists in the runner with matching cron / env / mcps.
- [ ] The **build factory's** real config (id/cron/env) is captured (remove `UNRECONCILED`).
- [x] Mobbin (§6b) attached to the Quality + GTM Auditors — done 2026-07-14.
- [x] Mobbin attached to the **build factories** — owner-confirmed 2026-07-14.
- [x] **Browser** for §44 Layer-B provisioned — Browserbase creds in the routine env
      (driven via Playwright), owner-confirmed 2026-07-14.
- [ ] Any orchestration change was made as a **diff to this file** + owner-approved
      (§38), not via an opaque UI edit.

---

*Last reconciled 2026-07-14. The product build factories remain `UNRECONCILED` on
id/cron/env only (their Mobbin + Browserbase capabilities are owner-confirmed);
capturing their trigger config from claude.ai closes the last gap. Honest, versioned
source of truth per §49 — not yet a complete census.*
