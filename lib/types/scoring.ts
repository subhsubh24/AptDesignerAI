export interface ProductScores {
  style_fit_score: number;
  palette_fit_score: number;
  material_fit_score: number;
  scale_fit_score: number;
  function_fit_score: number;
  cohesion_fit_score: number;
  value_fit_score: number;
  confidence_score: number;
}

export interface BundleScores {
  palette_harmony_score: number;
  material_balance_score: number;
  scale_balance_score: number;
  style_consistency_score: number;
  room_completion_score: number;
  practicality_score: number;
}

export type Verdict = "strong_yes" | "yes" | "maybe" | "no";

export interface ProductEvaluationResult {
  scores: ProductScores;
  final_item_score: number;
  verdict: Verdict;
  reasoning: {
    top_reasons: string[];
    risks: string[];
    suggestions: string[];
  };
}

export interface BundleEvaluationResult {
  scores: BundleScores;
  final_bundle_score: number;
  verdict: string;
  analysis: {
    strongest_aspect: string;
    weakest_aspect: string;
    what_feels_missing: string;
    what_should_be_swapped_first: string;
  };
}
