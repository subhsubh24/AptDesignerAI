#!/usr/bin/env node
// YEAR-1 EXIT run-rate for the shippable-TODAY scenario (Scenario B's installs/conversion, annual
// tier gated off, STORE channel) -- the honest "what does today's transactable product earn in
// year 1" figure, as distinct from business_case_without_annual_arr.mjs's STEADY-STATE $121,339.
//
// Added (GTM Factory) per the independent GTM Auditor's Run 5 business_case_honesty finding: the
// doc quoted $121,339/$136,762 as "the honest number for TODAY's transactable product... over the
// floor" with no year-1 caveat, even though those figures are computed via the identical
// multi-year steady-state pool formula as the $149.3K base case (which DOES carry a "steady-state,
// not year-1" box). This registers the missing year-1 reading so it is COMPUTED, not eyeballed
// (FACTORY_STANDARD S22), instead of citing the auditor's own ad-hoc estimate.
import { computeYear1ExitRunRate } from "./business-case-model.mjs";

const { year1ExitArr } = computeYear1ExitRunRate(
  /* installsPerMonth */ 4000,
  /* conversionRate */ 0.04,
  /* annualShareOfPro */ 0,
);
console.log(JSON.stringify({ value: Math.round(year1ExitArr) }));
