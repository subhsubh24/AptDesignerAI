#!/usr/bin/env node
// YEAR-1 EXIT run-rate for Scenario B (the base/planning case) -- the doc has stated this
// informally as "~$70-73K" (a prose range, not a registered figure) since the 2026-07-28
// take-rate correction. Registers the exact reproducible number so the existing "steady-state,
// not year-1" disclosure box cites a COMPUTED figure (FACTORY_STANDARD S22) rather than a range.
import { computeYear1ExitRunRate } from "./business-case-model.mjs";

const { year1ExitArr } = computeYear1ExitRunRate(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
);
console.log(JSON.stringify({ value: Math.round(year1ExitArr) }));
