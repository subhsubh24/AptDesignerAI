// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type { AgentRun, AgentStep } from "@/lib/types/database";

export async function createAgentRun(
  supabase: SupabaseClient,
  input: {
    room_id?: string;
    search_session_id?: string;
    agent_type: string;
    input_json?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from("agent_runs")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as AgentRun;
}

export async function completeAgentRun(
  supabase: SupabaseClient,
  id: string,
  result: {
    status: "completed" | "failed";
    output_json?: Record<string, unknown>;
    error_message?: string;
    tokens_used?: number;
    cost_estimate?: number;
  }
) {
  const { data, error } = await supabase
    .from("agent_runs")
    .update({
      ...result,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as AgentRun;
}

export async function addAgentStep(
  supabase: SupabaseClient,
  input: {
    agent_run_id: string;
    step_number: number;
    step_type: string;
    step_input_json?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from("agent_steps")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as AgentStep;
}

export async function completeAgentStep(
  supabase: SupabaseClient,
  id: string,
  result: {
    step_status: string;
    step_output_json?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from("agent_steps")
    .update({
      ...result,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as AgentStep;
}
