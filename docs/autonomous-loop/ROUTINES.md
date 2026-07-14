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
  checker §4, readiness gate §7, live-prod validation §44).
- **expected mcps:** Gmail (notify) · **Mobbin** (design grounding §6b) · **a
  browser** (§44 Layer-B live-prod vision pass). ⚠️ **VERIFY** these are attached
  — no routine the API returned had Mobbin or a browser MCP.

### Quality Auditor — the independent checker (maker ≠ checker twin)
- **id:** `trig_01Hiu9iTrqgMzQWdPQuFZEdG`
- **cron:** `30 9 */2 * *` — every 2 days, 09:30 UTC · **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Gmail`
- **role:** independent adversarial quality grader → writes `QUALITY_SCORECARD.md`.
- **gap:** grades design-taste (§31) but has **no browser / Mobbin MCP**, so §44
  Layer-B vision review + §6b grounding cannot run here. Attach a browser + Mobbin
  to enable, or file the gap.

### GTM Auditor
- **id:** `trig_01EQkT44rW5guBG42VEPjw9M`
- **cron:** `30 3 * * 1` — Mondays 03:30 UTC · **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Google_Drive`, `Gmail`, `Google_Calendar`
- **role:** independent GTM/growth grader → writes `GTM_SCORECARD.md`.

### Fleet stuck-PR janitor — fleet-wide (incl. AptDesignerAI)
- **id:** `trig_01EQZG8cVLFx7KPuhRSqx6Vk`
- **cron:** `37 */12 * * *` — every 12h UTC · **enabled:** yes
- **env:** `env_01DK5UzTyELJvjGUjtyGaGmh`
- **mcps:** `Google_Drive`, `Gmail`, `Claude_Code_Remote`

## Reconcile checklist (run each cycle — §49)
- [ ] Every routine above still exists in the runner with matching cron / env / mcps.
- [ ] The **build factory's** real config is captured (remove `UNRECONCILED`).
- [ ] Design-doing routines (build factory, Quality Auditor) have **Mobbin + a
      browser** MCP attached (§6b, §44) — or the gap is filed.
- [ ] Any orchestration change was made as a **diff to this file** + owner-approved
      (§38), not via an opaque UI edit.

---

*Seeded from the RemoteTrigger API (20 of N routines returned; the rest — notably
the product build factories — are `UNRECONCILED` pending capture from claude.ai).
This is the honest, versioned starting point per §49, not a complete census.*
