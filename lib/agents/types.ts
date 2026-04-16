import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DiagnosisData, DesignDirection, ExtractedFloorPlan } from "@/lib/types/database";

export interface DiagnosisItem {
  category: string;
  search_title?: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  specs?: string;
  placement?: string;
}

export interface AgentContext {
  roomId: string;
  roomType: string;
  roomName?: string;
  keepItems: string[];
  replaceItems: string[];
  priorities: string[];
  budgetMode: string;
  sourcingMode: string;
  imageUrls: string[];

  // Full apartment + building context — passed to system prompt for all agents
  designProfile?: DynamicDesignProfile;

  // Room diagnosis results — what's working, what's not, design direction
  diagnosis?: DiagnosisData;
  designDirection?: DesignDirection;

  // Area-analysis outputs — structured recommendations
  roomSummary?: string;
  whatItNeeds?: DiagnosisItem[];
  whatWorks?: string[];
  whatShouldGo?: string[];

  // Cross-session learning — user feedback from accepted/rejected products
  userFeedbackContext?: string;

  // User's free-text notes about their room photos (e.g., "ignore the boxes", "couch is being replaced")
  userContext?: string;

  // Cross-room coherence — other rooms' design direction for apartment consistency
  otherRoomsContext?: string;

  // Spatial context — per-item placement and overall layout plan
  spatialLayout?: string;
  placementMap?: Record<string, string>;
  floorPlan?: Record<string, unknown>;

  // Floor plan image + extracted spatial data (ground truth for all spatial facts).
  // When present these take priority over floorPlan and all photo-inferred dimensions.
  floorPlanImageUrl?: string;
  extractedFloorPlan?: ExtractedFloorPlan;

  // Environmental context — lighting, windows/doors, outlets
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;

  /**
   * Pre-formatted "EXISTING IDENTIFIED PIECES" block. Built by the search route
   * from `room_diagnoses.diagnosis_json.identified_products[]` (filtered to
   * verified & not-user-rejected). Empty/undefined when the furniture
   * identification feature is off OR when no usable identifications exist —
   * in which case downstream prompts stay byte-for-byte equivalent to their
   * pre-feature shape. See `lib/prompts/product-identification.ts`.
   */
  identifiedContext?: string;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
  model?: string;
}
