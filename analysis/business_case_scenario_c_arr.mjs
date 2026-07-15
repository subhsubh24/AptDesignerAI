#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "Scenario C -- Optimistic": 6,000 installs/mo, 6% conversion,
// 65% organic (organic share affects marketing cost/margin, not this ARR figure).
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 6000, /* conversionRate */ 0.06);
console.log(JSON.stringify({ value: Math.round(arr) }));
