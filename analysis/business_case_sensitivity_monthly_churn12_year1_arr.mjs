#!/usr/bin/env node
// YEAR-1 EXIT run-rate for the "Monthly Pro churn rises from 7% -> 12%" sensitivity
// (Scenario B inputs, monthly churn raised to 12%; Annual Pro pool unchanged) -- pairs with
// business_case_sensitivity_monthly_churn12_arr.mjs's STEADY-STATE $113,604 figure.
//
// GTM Auditor Run 6 (docs/growth/GTM_SCORECARD.md, business_case_honesty) found the doc claimed
// this steady-state figure "CLEARS the floor" with no year-1 caveat, despite using the identical
// multi-year pool-fill formula as every other steady-state figure in this document (all of which
// DO carry the caveat). Independently re-derived: the year-1 exit run-rate is $60,593 -- BELOW
// the $100K floor, and worse than the $71,207 base-case year-1 figure. This script registers that
// reproducible number (FACTORY_STANDARD S22).
import { computeYear1ExitRunRate } from "./business-case-model.mjs";

const { year1ExitArr } = computeYear1ExitRunRate(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  undefined,
  /* monthlyChurn */ 0.12,
);
console.log(JSON.stringify({ value: Math.round(year1ExitArr) }));
