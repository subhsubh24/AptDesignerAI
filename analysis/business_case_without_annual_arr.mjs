#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "What would have to change to NOT reach $100K" ->
// "Annual mix stays at 0%": Scenario B's installs/conversion (the planning case) but with
// annualShareOfPro=0, since Pro Annual is currently gated off in prod (migration 021 unapplied,
// ANNUAL_BILLING_ENABLED off -- PENDING_OPS.md apply-migration-021). This is the SHIPPABLE-TODAY
// ARR figure the independent Quality Auditor (QUALITY_SCORECARD.md business_case_strength) cites
// precisely as $99,926, and the GTM Auditor (GTM_SCORECARD.md) cites rounded as ~$99.9K --
// ~$74 BELOW the $100K floor either way.
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 4000, /* conversionRate */ 0.04, /* annualShareOfPro */ 0);
console.log(JSON.stringify({ value: Math.round(arr) }));
