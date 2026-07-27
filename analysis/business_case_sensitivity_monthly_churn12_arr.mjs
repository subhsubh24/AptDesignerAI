#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "What would have to change to NOT reach $100K" ->
// "Monthly Pro churn rises from 7% -> 12%": Scenario B inputs (4,000 installs/mo, 4%
// conversion, 40% organic) with monthly Pro churn raised from 7% to 12%; the Annual Pro
// pool is unchanged (this sensitivity isolates the monthly-tier churn variable only).
// GTM Auditor Run 4 found this figure ("~$85K") did not reproduce and sat outside the
// computation gate -- this script + its figures.json registration closes that gap.
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 4000, /* conversionRate */ 0.04, undefined, 0.12);
console.log(JSON.stringify({ value: Math.round(arr) }));
