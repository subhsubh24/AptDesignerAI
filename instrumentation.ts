import { assertProductionEnv } from "@/lib/config/env";

export function register() {
  // Runs once per server process at startup. In production this throws if
  // required keys are missing, causing the deploy to fail loud rather than
  // serving 500s at request time.
  assertProductionEnv();
}
