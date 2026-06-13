import { type TaskType, type ThinkingTier, defaultThinking } from "./models";

export function thinkingFor(
  task: TaskType,
  override?: ThinkingTier,
): { thinkingLevel: ThinkingTier } {
  return { thinkingLevel: override ?? defaultThinking(task) };
}
