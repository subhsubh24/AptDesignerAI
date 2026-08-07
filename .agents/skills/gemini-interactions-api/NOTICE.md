# Third-Party Notices

This directory vendors a third-party skill, used under the terms of its original license.

## Gemini Interactions API Skill

`SKILL.md` and `references/migration.md` are vendored unmodified from Google's
`gemini-skills` repository. They document the Gemini Interactions API — the
current replacement for the older `generateContent` API — and are used here as
agent guidance, not as shipped application code.

**Original work:** https://github.com/google-gemini/gemini-skills
**Original license:** Apache-2.0
**Skill path upstream:** `skills/gemini-interactions-api/SKILL.md`
**Pinned content hash:** `f818c4fda40bd30c539f87726cacc2b2467ac342d0b103e042b1be5f11b91073`
(recorded in `/skills-lock.json`)

`LICENSE` in this directory is the Apache License 2.0 as upstream ships it —
including the unfilled `Copyright [yyyy] [name of copyright owner]` placeholder,
which upstream has not customized. It is reproduced verbatim rather than
filled in on Google's behalf.

### Note for this repo

This skill's model list is upstream's and describes the **Gemini** family
(`gemini-3.5-flash`, `gemini-3.1-pro-preview`, and so on). It does not override
this repo's LLM cost contract in `CLAUDE.md`, which pins text tasks to
`TEXT_TIERS.base` and is guarded by `__tests__/ai/harness-ratchet.test.ts`. Where
the two disagree, the cost contract wins — treat the skill as API-shape
reference, not as model-selection guidance.
