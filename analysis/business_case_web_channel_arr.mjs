#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "Channel economics" -> the WEB/Stripe reading of the
// shippable-TODAY case: Scenario B's installs/conversion (the planning case) with
// annualShareOfPro=0, priced on Stripe's published fees rather than a store commission.
//
// This scenario exists because the without-annual figure is web-specific BY CONSTRUCTION:
// the only reason annual is zeroed is that Pro Annual is gated off in lib/billing/stripe.ts +
// migration 021 -- Stripe concerns that have no equivalent on the store channel. Pricing that
// figure at a store commission (as this model did until 2026-07-28) applied an app-store take
// rate to revenue the same sentence argued could only be collected over Stripe.
//
// The store-channel reading of the same case stays registered as
// business_case_without_annual_arr; the two together are the honest band, and the headline
// figure remains the LOWER (store) one.
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  /* annualShareOfPro */ 0,
  /* monthlyChurn */ undefined,
  /* annualEffectiveMonthlyChurn */ undefined,
  /* channel */ "web",
);
console.log(JSON.stringify({ value: Math.round(arr) }));
