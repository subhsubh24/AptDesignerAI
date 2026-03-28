import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DiagnosisData, DesignDirection } from "@/lib/types/database";

export interface AgentContext {
  roomId: string;
  roomType: string;
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

  // Cross-session learning — user feedback from accepted/rejected products
  userFeedbackContext?: string;

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
