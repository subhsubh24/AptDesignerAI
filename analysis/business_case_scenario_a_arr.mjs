#!/usr/bin/env node
// Reproduces docs/BUSINESS_CASE.md "Scenario A -- Conservative": 2,000 installs/mo, 3% conversion,
// 70% organic (organic share affects marketing cost/margin, not this ARR figure).
import { computeScenario } from "./business-case-model.mjs";

const { arr } = computeScenario(/* installsPerMonth */ 2000, /* conversionRate */ 0.03);
console.log(JSON.stringify({ value: Math.round(arr) }));
