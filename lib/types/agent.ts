import type { AgentType, AgentRunStatus } from "./database";

export interface AgentInput {
  [key: string]: unknown;
}

export interface AgentOutput {
  [key: string]: unknown;
}

export interface AgentRunConfig {
  agent_type: AgentType;
  room_id?: string;
  search_session_id?: string;
  input: AgentInput;
  max_steps?: number;
  timeout_ms?: number;
}

export interface AgentRunResult {
  run_id: string;
  status: AgentRunStatus;
  output: AgentOutput | null;
  error?: string;
  tokens_used?: number;
  cost_estimate?: number;
  duration_ms?: number;
}

export interface AgentStepLog {
  step_number: number;
  step_type: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  started_at: string;
  finished_at?: string;
}
