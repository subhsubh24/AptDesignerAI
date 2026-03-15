export interface AgentContext {
  roomId: string;
  roomType: string;
  keepItems: string[];
  replaceItems: string[];
  priorities: string[];
  budgetMode: string;
  sourcingMode: string;
  imageUrls: string[];
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
  model?: string;
}
