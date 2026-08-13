import { type TaskType, type ThinkingTier, defaultThinking } from "./models";

export function thinkingFor(
  task: TaskType,
  override?: ThinkingTier,
  opts?: { includeThoughts?: boolean },
): { thinkingLevel: ThinkingTier; includeThoughts?: boolean } {
  return {
    thinkingLevel: override ?? defaultThinking(task),
    ...(opts?.includeThoughts ? { includeThoughts: true } : {}),
  };
}
