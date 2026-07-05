import type { Verdict } from "@/lib/types/scoring";

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_yes: "Strong Yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

export const VERDICT_COLORS: Record<Verdict, string> = {
  strong_yes: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950 dark:border-emerald-800",
  yes: "text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950 dark:border-green-800",
  maybe: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950 dark:border-amber-800",
  no: "text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950 dark:border-red-800",
};

export function getScoreColor(score: number): string {
  // Darker light-mode weights so score text clears WCAG 2 AA (4.5:1) on the
  // near-white app background — emerald/amber/rose-600 sit at ~3.0–3.6:1 and
  // fail an axe color-contrast check. The -700/-800 weights keep the same
  // traffic-light semantics while passing AA; dark-mode -400 already passes.
  if (score >= 8) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 6) return "text-amber-800 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export function getScoreBgColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-amber-500";
  return "bg-rose-500";
}
