#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "What would have to change to NOT reach $100K" ->
// "Annual renewal churn rises to 40% (-> 4.2%/month effective)": Scenario B inputs
// (4,000 installs/mo, 4% conversion, 40% organic) with the Annual Pro tier's effective
// monthly churn raised (from the base case's 2.4%) to the compounding-equivalent of a
// 40% annual renewal churn; the Monthly Pro tier is unchanged (this sensitivity isolates
// the annual-tier churn variable only).
//
// The effective monthly rate is derived the same way business-case-model.mjs's
// ANNUAL_EFFECTIVE_MONTHLY_CHURN comment derives the base case's 2.4% ("1 - 0.75^(1/12)"):
// 1 - (1 - 0.40)^(1/12) ~= 4.17%/month, which the doc prose rounds to "4.2%/month effective".
//
// GTM Auditor Run 4 found this figure ("~$106K") did not reproduce -- it erred in the
// FLATTERING direction (made the downside look like it cleared $100K by $6K when it
// actually clears by ~$3.2K) -- and sat outside the computation gate. This script +
// its figures.json registration closes that gap.
import { computeScenario } from "./business-case-model.mjs";

const annualChurnAt40PctYr = 1 - Math.pow(1 - 0.4, 1 / 12);
const { arr } = computeScenario(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  undefined,
  undefined,
  annualChurnAt40PctYr,
);
console.log(JSON.stringify({ value: Math.round(arr) }));
