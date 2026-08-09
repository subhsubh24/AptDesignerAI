import { describe, expect, it, vi } from "vitest";
import {
  addAgentStep,
  completeAgentRun,
  completeAgentStep,
  createAgentRun,
} from "@/lib/db/agent-runs";

/**
 * lib/db/agent-runs.ts writes the AI pipeline's audit trail (agent_runs /
 * agent_steps). Every function is a thin Supabase wrapper that throws on
 * `error` and otherwise returns `data` — these tests mock the chainable
 * client (matching __tests__/storage/mockup-upload.test.ts's pattern) to
 * verify both branches for all four functions.
 */

function insertStub(data: unknown, error: unknown = null) {
  const single = vi.fn(async () => ({ data, error }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { supabase: { from }, from, insert, select, single };
}

function updateStub(data: unknown, error: unknown = null) {
  const single = vi.fn(async () => ({ data, error }));
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { supabase: { from }, from, update, eq, select, single };
}

describe("createAgentRun", () => {
  it("inserts into agent_runs and returns the created row", async () => {
    const row = { id: "run-1", agent_type: "diagnosis" };
    const { supabase, from, insert } = insertStub(row);
    const input = { agent_type: "diagnosis", room_id: "room-1", input_json: { a: 1 } };

    const result = await createAgentRun(supabase, input);

    expect(from).toHaveBeenCalledWith("agent_runs");
    expect(insert).toHaveBeenCalledWith(input);
    expect(result).toBe(row);
  });

  it("throws the Supabase error instead of returning it", async () => {
    const { supabase } = insertStub(null, new Error("insert failed"));
    await expect(
      createAgentRun(supabase, { agent_type: "diagnosis" }),
    ).rejects.toThrow("insert failed");
  });
});

describe("completeAgentRun", () => {
  it("updates by id, stamps finished_at, and passes the result fields through", async () => {
    const row = { id: "run-1", status: "completed" };
    const { supabase, from, update, eq } = updateStub(row);
    const before = Date.now();

    const result = await completeAgentRun(supabase, "run-1", {
      status: "completed",
      output_json: { ok: true },
      tokens_used: 42,
      cost_estimate: 0.01,
    });

    expect(from).toHaveBeenCalledWith("agent_runs");
    expect(eq).toHaveBeenCalledWith("id", "run-1");
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload).toMatchObject({
      status: "completed",
      output_json: { ok: true },
      tokens_used: 42,
      cost_estimate: 0.01,
    });
    // finished_at must be a real, current ISO timestamp, not a placeholder.
    const finishedAt = Date.parse(payload.finished_at as string);
    expect(Number.isNaN(finishedAt)).toBe(false);
    expect(finishedAt).toBeGreaterThanOrEqual(before);
    expect(result).toBe(row);
  });

  it("passes through a failed status with its error_message", async () => {
    const { supabase, update } = updateStub({ id: "run-1", status: "failed" });
    await completeAgentRun(supabase, "run-1", {
      status: "failed",
      error_message: "pipeline exploded",
    });
    expect(update.mock.calls[0][0]).toMatchObject({
      status: "failed",
      error_message: "pipeline exploded",
    });
  });

  it("throws the Supabase error instead of returning it", async () => {
    const { supabase } = updateStub(null, new Error("update failed"));
    await expect(
      completeAgentRun(supabase, "run-1", { status: "completed" }),
    ).rejects.toThrow("update failed");
  });
});

describe("addAgentStep", () => {
  it("inserts into agent_steps and returns the created row", async () => {
    const row = { id: "step-1", step_number: 1 };
    const { supabase, from, insert } = insertStub(row);
    const input = {
      agent_run_id: "run-1",
      step_number: 1,
      step_type: "diagnose",
      step_input_json: { foo: "bar" },
    };

    const result = await addAgentStep(supabase, input);

    expect(from).toHaveBeenCalledWith("agent_steps");
    expect(insert).toHaveBeenCalledWith(input);
    expect(result).toBe(row);
  });

  it("throws the Supabase error instead of returning it", async () => {
    const { supabase } = insertStub(null, new Error("step insert failed"));
    await expect(
      addAgentStep(supabase, { agent_run_id: "run-1", step_number: 1, step_type: "diagnose" }),
    ).rejects.toThrow("step insert failed");
  });
});

describe("completeAgentStep", () => {
  it("updates by id, stamps finished_at, and passes the result fields through", async () => {
    const row = { id: "step-1", step_status: "completed" };
    const { supabase, from, update, eq } = updateStub(row);
    const before = Date.now();

    const result = await completeAgentStep(supabase, "step-1", {
      step_status: "completed",
      step_output_json: { done: true },
    });

    expect(from).toHaveBeenCalledWith("agent_steps");
    expect(eq).toHaveBeenCalledWith("id", "step-1");
    const payload = update.mock.calls[0][0];
    expect(payload).toMatchObject({
      step_status: "completed",
      step_output_json: { done: true },
    });
    const finishedAt = Date.parse(payload.finished_at as string);
    expect(Number.isNaN(finishedAt)).toBe(false);
    expect(finishedAt).toBeGreaterThanOrEqual(before);
    expect(result).toBe(row);
  });

  it("throws the Supabase error instead of returning it", async () => {
    const { supabase } = updateStub(null, new Error("step update failed"));
    await expect(
      completeAgentStep(supabase, "step-1", { step_status: "failed" }),
    ).rejects.toThrow("step update failed");
  });
});
