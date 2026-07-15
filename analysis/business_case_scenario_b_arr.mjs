#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "Scenario B -- Base (planning case)": 4,000 installs/mo,
// 4% conversion, 40% organic (organic share affects marketing cost/margin, not this ARR figure).
// This is the steady-state base ARR cited in BUSINESS_CASE_SUMMARY.arr_year1.base.
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 4000, /* conversionRate */ 0.04);
console.log(JSON.stringify({ value: Math.round(arr) }));
