#!/usr/bin/env node
// YEAR-1 EXIT run-rate for the shippable-TODAY scenario on the WEB/Stripe channel -- the higher
// end of the band quoted alongside business_case_without_annual_year1_arr.mjs's store reading.
// Same rationale: closes the GTM Auditor Run 5 business_case_honesty disclosure gap with a
// COMPUTED figure rather than an eyeballed one (FACTORY_STANDARD S22).
import { computeYear1ExitRunRate } from "./business-case-model.mjs";

const { year1ExitArr } = computeYear1ExitRunRate(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  /* annualShareOfPro */ 0,
  /* monthlyChurn */ undefined,
  /* annualEffectiveMonthlyChurn */ undefined,
  /* channel */ "web",
);
console.log(JSON.stringify({ value: Math.round(year1ExitArr) }));
