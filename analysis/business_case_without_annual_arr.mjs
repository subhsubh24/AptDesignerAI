#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "What would have to change to NOT reach $100K" ->
// "Annual mix stays at 0%": Scenario B's installs/conversion (the planning case) but with
// annualShareOfPro=0, since Pro Annual is currently gated off in prod (migration 021 unapplied,
// ANNUAL_BILLING_ENABLED off -- PENDING_OPS.md apply-migration-021). This is the SHIPPABLE-TODAY
// ARR figure.
//
// Priced on the STORE channel -- the conservative end of the band. The web/Stripe reading of the
// same case lives in business_case_web_channel_arr.mjs and is the higher of the two; both are
// registered in analysis/figures.json, so neither end is quotable without being verified.
//
// RE-PRICED 2026-07-28. This script printed $99,926 -- ~$74 BELOW the $100K floor -- and both the
// independent Quality Auditor (QUALITY_SCORECARD.md business_case_strength) and the GTM Auditor
// (GTM_SCORECARD.md) cited that number as the gap keeping the business case off an A. It was an
// artifact: business-case-model.mjs applied a flat 30% commission, which is the rate ABOVE $1M in
// proceeds and is charged on NEITHER channel at this scale (Apple Small Business Program 15%,
// Google Play first-$1M ~15% effective, Stripe 2.9% + $0.30). At the rate actually charged, the
// same inputs -- every behavioural input unchanged -- give $121,339 here and $136,762 on
// web/Stripe. See the take-rate correction entry at the top of docs/BUSINESS_CASE.md.
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 4000, /* conversionRate */ 0.04, /* annualShareOfPro */ 0);
console.log(JSON.stringify({ value: Math.round(arr) }));
