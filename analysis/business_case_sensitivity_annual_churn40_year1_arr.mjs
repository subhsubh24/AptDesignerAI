#!/usr/bin/env node
// YEAR-1 EXIT run-rate for the "Annual renewal churn rises to 40%" sensitivity (Scenario B
// inputs, Annual Pro's effective monthly churn raised to the compounding-equivalent of 40%
// annual churn; Monthly Pro pool unchanged) -- pairs with
// business_case_sensitivity_annual_churn40_arr.mjs's STEADY-STATE $125,331 figure.
//
// GTM Auditor Run 6 (docs/growth/GTM_SCORECARD.md, business_case_honesty) found the doc claimed
// this steady-state figure "CLEARS the floor" with no year-1 caveat, despite using the identical
// multi-year pool-fill formula as every other steady-state figure in this document (all of which
// DO carry the caveat). Independently re-derived: the year-1 exit run-rate is $69,934 -- BELOW
// the $100K floor, and worse than the $71,207 base-case year-1 figure. This script registers that
// reproducible number (FACTORY_STANDARD S22).
import { computeYear1ExitRunRate } from "./business-case-model.mjs";

const annualChurnAt40PctYr = 1 - Math.pow(1 - 0.4, 1 / 12);
const { year1ExitArr } = computeYear1ExitRunRate(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  undefined,
  undefined,
  annualChurnAt40PctYr,
);
console.log(JSON.stringify({ value: Math.round(year1ExitArr) }));
