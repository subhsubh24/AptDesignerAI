import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

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

  // Environmental context — lighting, windows/doors, outlets
  lightingConditions?: string;
  windowDoorPositions?: string;
  outletPositions?: string;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
  model?: string;
}
