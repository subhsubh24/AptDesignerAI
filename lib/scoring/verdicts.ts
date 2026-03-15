import type { Verdict } from "@/lib/types/scoring";

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_yes: "Strong Yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

export const VERDICT_COLORS: Record<Verdict, string> = {
  strong_yes: "text-emerald-700 bg-emerald-50 border-emerald-200",
  yes: "text-green-700 bg-green-50 border-green-200",
  maybe: "text-amber-700 bg-amber-50 border-amber-200",
  no: "text-red-700 bg-red-50 border-red-200",
};

export function getScoreColor(score: number): string {
  if (score >= 7.5) return "text-emerald-600";
  if (score >= 6.0) return "text-green-600";
  if (score >= 4.5) return "text-amber-600";
  return "text-red-600";
}
