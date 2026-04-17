export type RoomType = "living_room" | "dining_area" | "kitchen" | "bedroom" | "bathroom";
export type BudgetMode = "budget" | "balanced" | "best_possible";
export type SourcingMode = "manual" | "agentic" | "hybrid";
export type RoomStatus = "setup" | "diagnosed" | "sourcing" | "bundled" | "completed";
export type ProjectStatus = "active" | "archived" | "completed";
export type ProductStatus = "pending" | "evaluated" | "shortlisted" | "rejected" | "accepted";
export type ProductSourceType = "manual_url" | "manual_upload" | "agentic_search" | "screenshot";
export type BundleStatus = "draft" | "evaluated" | "accepted" | "rejected";
export type SearchSessionStatus = "active" | "paused" | "completed" | "cancelled";
export type AgentType = "diagnostician" | "researcher" | "extractor" | "scorer" | "bundler" | "mockup";
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";
export type MockupStatus = "pending" | "generating" | "completed" | "failed";
export type ImageType = "room" | "apartment_context" | "detail" | "floor_plan";
export type Verdict = "strong_yes" | "yes" | "maybe" | "no";

// ─── Floor Plan Types ─────────────────────────────────────────────────────────

export interface WallFeature {
  type: "window" | "door" | "closet" | "built_in" | "opening" | "radiator";
  position_on_wall: "left" | "left-center" | "center" | "right-center" | "right";
  width_ft?: number;
  notes?: string;
}

export interface FloorPlanWall {
  /** Compass direction if determinable from north arrow, otherwise "wall_1" etc. */
  direction: string;
  length_ft?: number;
  features: WallFeature[];
}

export interface FloorPlanRoom {
  room_type: string;           // "living_room" | "bedroom" | etc.
  label: string;               // As labeled on the plan: "Living/Dining", "BR1"
  sqft?: number;
  dimensions_text?: string;    // "12 × 15 ft"
  width_ft?: number;
  depth_ft?: number;
  shape: "rectangular" | "L-shaped" | "irregular";
  walls: FloorPlanWall[];
  natural_light: "high" | "medium" | "low";
  traffic_notes?: string;
  notes?: string;
}

export interface ExtractedFloorPlan {
  image_url: string;
  extracted_at: string;        // ISO timestamp
  confidence: "high" | "medium" | "low";
  total_sqft?: number;
  building_orientation?: string; // "north arrow points up", "south-facing main facade"
  rooms: FloorPlanRoom[];
  scale_note?: string;
  overall_notes?: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  project_id: string;
  name: string;
  room_type: RoomType;
  budget_mode: BudgetMode;
  budget_dollars: number | null;
  sourcing_mode: SourcingMode;
  priorities: string[];
  keep_items: string[];
  replace_items: string[];
  status: RoomStatus;
  created_at: string;
  updated_at: string;
}

export interface RoomImage {
  id: string;
  room_id: string;
  image_url: string;
  image_type: ImageType;
  storage_path: string | null;
  caption: string | null;
  created_at: string;
}

export interface RoomDiagnosis {
  id: string;
  room_id: string;
  diagnosis_json: DiagnosisData;
  design_direction_json: DesignDirection | null;
  missing_categories: string[] | null;
  action_list: ActionItem[] | null;
  model_used: string | null;
  /** Greedy expansion decision log — null when expansion was skipped */
  expansion_log?: DecoratorDecision[] | null;
  created_at: string;
}

export interface CandidateProduct {
  id: string;
  room_id: string;
  search_session_id: string | null;
  title: string | null;
  category: string | null;
  retailer: string | null;
  product_url: string | null;
  image_url: string | null;
  local_image_path: string | null;
  price: number | null;
  dimensions: ProductDimensions | null;
  materials: string[] | null;
  colors: string[] | null;
  description: string | null;
  source_type: ProductSourceType;
  metadata: Record<string, unknown> | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductEvaluation {
  id: string;
  product_id: string;
  room_id: string;
  style_fit_score: number;
  palette_fit_score: number;
  material_fit_score: number;
  scale_fit_score: number;
  function_fit_score: number;
  cohesion_fit_score: number;
  value_fit_score: number;
  confidence_score: number;
  final_item_score: number;
  verdict: Verdict;
  reasoning: EvaluationReasoning;
  model_used: string | null;
  created_at: string;
}

export interface ProductBundle {
  id: string;
  room_id: string;
  name: string | null;
  description: string | null;
  status: BundleStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductBundleItem {
  id: string;
  bundle_id: string;
  product_id: string;
  category: string | null;
  sort_order: number;
  created_at: string;
}

export interface BundleEvaluation {
  id: string;
  bundle_id: string;
  palette_harmony_score: number;
  material_balance_score: number;
  scale_balance_score: number;
  style_consistency_score: number;
  room_completion_score: number;
  practicality_score: number;
  final_bundle_score: number;
  verdict: string | null;
  analysis: BundleAnalysis;
  room_vibe: RoomVibe | null;
  model_used: string | null;
  created_at: string;
}

export interface MockupJob {
  id: string;
  room_id: string;
  bundle_id: string | null;
  prompt: string | null;
  selected_products: Record<string, unknown> | null;
  generation_provider: string | null;
  generation_metadata: Record<string, unknown> | null;
  result_image_url: string | null;
  storage_path: string | null;
  status: MockupStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SearchSession {
  id: string;
  room_id: string;
  mode: SourcingMode;
  status: SearchSessionStatus;
  search_brief_json: Record<string, unknown> | null;
  categories_to_search: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface SavedItem {
  id: string;
  user_id: string;
  product_id: string;
  room_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface AgentRun {
  id: string;
  room_id: string | null;
  search_session_id: string | null;
  agent_type: AgentType;
  status: AgentRunStatus;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  error_message: string | null;
  tokens_used: number | null;
  cost_estimate: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface AgentStep {
  id: string;
  agent_run_id: string;
  step_number: number;
  step_type: string;
  step_status: string;
  step_input_json: Record<string, unknown> | null;
  step_output_json: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
}

// Nested JSON types

export interface DiagnosisData {
  current_vibe_summary: string;
  what_is_working: string[];
  what_is_not_working: string[];
  biggest_improvement_opportunities: string[];
  missing_furniture_categories: string[];
  color_issues: string[];
  texture_material_issues: string[];
  scale_proportion_issues: string[];
  layout_issues: string[];
  spatial_gaps: string[];
  lighting_issues: string[];
  clutter_editing_issues: string[];
  /**
   * Populated by the furniture product identification pipeline when
   * IDENTIFY_PRODUCTS=1 is set. Absence = feature off or pre-feature row;
   * downstream readers MUST treat it as optional.
   */
  identified_products?: IdentifiedProduct[];
}

export interface DesignDirection {
  recommended_palette: string[];
  recommended_materials: string[];
  recommended_textures: string[];
  recommended_furniture_types: string[];
  style_notes: string;
}

export interface ActionItem {
  priority: number;
  action: string;
  category: string;
  reasoning: string;
  /** Distinguishes sub-types within a category (e.g. "trailing shelf" vs "tall floor") */
  variant?: string;
  /** Number of this item to source — undefined = 1 */
  quantity?: number;
  /** WHERE in the room — reference walls, windows, doors, and existing furniture */
  placement?: string;
  /** Tracks whether produced by initial diagnosis or greedy expansion */
  source?: "diagnosis" | "expansion";
}

/** One step in the greedy expansion decision log */
export interface DecoratorDecision {
  iteration: number;
  verdict:
    | "ADD"
    | "STOP"
    | "GUARDRAIL_REJECTED"
    | "CRITIQUE_ADD"
    | "CRITIQUE_SWAP"
    | "CRITIQUE_REMOVE";
  item?: Partial<ActionItem>;
  reasoning: string;
  density_feel: string;
  saturation_pct: number;
  /** For SWAP/REMOVE critique ops: the targeted item's index in the list at time of decision. */
  target_index?: number;
}

export interface ProductDimensions {
  width?: number;
  depth?: number;
  height?: number;
  diameter?: number;
  unit: "inches" | "cm";
}

export interface EvaluationReasoning {
  top_reasons: string[];
  risks: string[];
  suggestions: string[];
}

export interface BundleAnalysis {
  strongest_aspect: string;
  weakest_aspect: string;
  what_feels_missing: string;
  what_should_be_swapped_first: string;
}

export interface RoomVibe {
  vibe_summary: string;
  style_keywords: string[];
  color_story: string;
  mood: string;
}

// ─── Identified Products (inline in room_diagnoses.diagnosis_json) ────

/**
 * Bounding box in normalized coordinates (0..1) relative to source image.
 */
export interface IdentifiedProductBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IdentifiedProductDimensions {
  width_in?: number;
  depth_in?: number;
  height_in?: number;
}

export interface IdentifiedProductPriceRange {
  min: number;
  max: number;
  currency: string;
}

export interface IdentifiedProductRetrievalPrior {
  brand: string;
  model: string;
  similarity: number;
}

/**
 * Enriched identified product — exact brand/model recognized from room photos,
 * verified via grounded web search, and enriched with canonical product data
 * (dimensions, materials, colors, price). Stored inline in
 * `room_diagnoses.diagnosis_json.identified_products[]`.
 *
 * Downstream callers MUST read with:
 *   (diagnosis.identified_products ?? [])
 *     .filter(p => p.verified && p.user_confirmed !== false)
 * so absence is equivalent to the pre-feature behavior.
 */
export interface IdentifiedProduct {
  brand: string;
  model: string;
  variant?: string | null;
  category: string;
  /** 0..1 post-verification confidence. */
  confidence: number;
  /** Passed grounded match check (match_score >= 0.75). */
  verified: boolean;
  /** null = not yet asked. Set by user confirmation endpoint. */
  user_confirmed?: boolean | null;
  canonical_url?: string | null;
  source_urls?: string[];
  dimensions?: IdentifiedProductDimensions | null;
  materials?: string[];
  colors?: string[];
  price_range?: IdentifiedProductPriceRange | null;
  image_url?: string | null;
  evidence?: string;
  distinguishing_features?: string[];
  retrieval_priors?: IdentifiedProductRetrievalPrior[];
  /** "model" = produced by identifier; "user" = produced by Different-Model correction. */
  correction_source?: "model" | "user";
  /** True once the confirmed crop's embedding has been written back to the index. */
  embedding_written_back?: boolean;
  bounding_box?: IdentifiedProductBoundingBox | null;
  /** URL of the room photo the crop came from — used for self-learning write-back. */
  source_image_url?: string | null;
}

/**
 * Row stored in the in-memory / pgvector `product_image_embeddings` table.
 * Populated by scripts/seed-product-embeddings.ts and by the self-learning
 * loop after user confirmations.
 */
export interface ProductImageEmbedding {
  id: string;
  brand: string;
  model: string;
  variant: string | null;
  image_url: string;
  /** 1408-dim for Gemini multimodalembedding@001 (other models may differ). */
  embedding: number[];
  /** "catalog" seed, "user_confirmed" self-learning write-back, etc. */
  source: string;
  created_at: string;
}
