#!/usr/bin/env bash
# PreToolUse guard: block edits to the ratchet/floor tests that enforce the
# LLM cost contract. Per .claude/rules/llm-cost-contract.md, these tests exist
# so cost can only go down silently, never up — the rule is "add config, never
# relax the guarding test." This hook makes that rule deterministic instead of
# advisory. It does NOT block reads or test runs, only Edit/Write to the files.
#
# Reads the PreToolUse JSON event on stdin; exits 2 (block) with a stderr
# message that Claude Code feeds back to the model, or 0 (allow) otherwise.

set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"

[ -z "$file_path" ] && exit 0

case "$file_path" in
  *__tests__/ai/harness-ratchet.test.ts|*__tests__/ai/provider-floors.test.ts)
    base="$(basename "$file_path")"
    echo "BLOCKED: $base is a load-bearing ratchet test (see .claude/rules/llm-cost-contract.md)." >&2
    echo "These tests exist so LLM cost can only go down, never up. Do NOT relax them to" >&2
    echo "make a change pass — instead add the required thinkingConfig/floor on the new" >&2
    echo "call site so the existing assertion still holds. If a floor genuinely moved," >&2
    echo "bump gemini.ts AND deepseek.ts together and update the test in the same commit," >&2
    echo "then re-run with explicit human confirmation that this is an intentional floor change." >&2
    exit 2
    ;;
esac

exit 0
