import { describe, it, expect } from "vitest";
import {
  formatExtractedFloorPlanForPrompt,
  getRoomFromFloorPlan,
} from "@/lib/agents/format-floor-plan";
import type { ExtractedFloorPlan, FloorPlanRoom } from "@/lib/types/database";

// The formatter is a pure, deterministic prompt-builder used by every agent
// that doesn't receive the floor-plan image (fit-scorer, bundle-optimizer,
// greedy-decorator, search-brief, product-eval, bundle-eval), so a formatting
// regression silently corrupts those prompts. These tests pin the branch
// behavior — primary/other-room split, wall-feature aggregation, and the
// room_type exact→prefix fallback.

function makeRoom(overrides: Partial<FloorPlanRoom> = {}): FloorPlanRoom {
  return {
    room_type: "living_room",
    label: "Living/Dining",
    shape: "rectangular",
    natural_light: "high",
    walls: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<ExtractedFloorPlan> = {}): ExtractedFloorPlan {
  return {
    image_url: "https://example.com/plan.png",
    extracted_at: "2026-01-01T00:00:00.000Z",
    confidence: "high",
    rooms: [makeRoom()],
    ...overrides,
  };
}

describe("formatExtractedFloorPlanForPrompt", () => {
  it("returns an empty string for a nullish plan", () => {
    expect(formatExtractedFloorPlanForPrompt(null)).toBe("");
    expect(formatExtractedFloorPlanForPrompt(undefined)).toBe("");
    expect(formatExtractedFloorPlanForPrompt(null, "bedroom")).toBe("");
  });

  it("renders the authoritative header with confidence and optional scale/orientation/total", () => {
    const out = formatExtractedFloorPlanForPrompt(
      makePlan({
        confidence: "medium",
        scale_note: "1in = 4ft",
        building_orientation: "north arrow points up",
        total_sqft: 850,
      }),
    );
    expect(out).toContain(
      "## FLOOR PLAN (authoritative — do not infer dimensions from photos)",
    );
    expect(out).toContain("Confidence: medium | Scale: 1in = 4ft");
    expect(out).toContain("Orientation: north arrow points up");
    expect(out).toContain("Total apartment: ~850 sqft");
  });

  it("omits the optional lines when those fields are absent", () => {
    const out = formatExtractedFloorPlanForPrompt(makePlan({ confidence: "low" }));
    expect(out).toContain("Confidence: low");
    expect(out).not.toContain("| Scale:");
    expect(out).not.toContain("Orientation:");
    expect(out).not.toContain("Total apartment:");
  });

  it("shows the primary room in full detail when roomType matches exactly", () => {
    const plan = makePlan({
      rooms: [
        makeRoom({
          room_type: "bedroom",
          label: "BR1",
          dimensions_text: "12 × 15 ft",
          shape: "L-shaped",
          natural_light: "medium",
          traffic_notes: "door swings into the room",
          notes: "radiator under the window",
          walls: [
            {
              direction: "north",
              length_ft: 12,
              features: [
                { type: "window", position_on_wall: "center" },
                { type: "window", position_on_wall: "right", width_ft: 3 },
              ],
            },
            { direction: "east", features: [] },
          ],
        }),
      ],
    });
    const out = formatExtractedFloorPlanForPrompt(plan, "bedroom");
    expect(out).toContain("This bedroom (BR1) — ~12 × 15 ft:");
    expect(out).toContain("Shape: L-shaped | Natural light: medium");
    expect(out).toContain("Traffic: door swings into the room");
    // Two window features on the same wall collapse into one aggregated clause,
    // and the width annotation only renders for the feature that has it.
    expect(out).toContain(
      "north wall (12ft): 2 windows (center, right (3ft wide))",
    );
    // A wall with zero features is skipped entirely (not rendered as a line).
    expect(out).not.toContain("east wall");
    expect(out).toContain("Notes: radiator under the window");
  });

  it("annotates '(no features noted)' when the primary room has no wall features at all", () => {
    const plan = makePlan({
      rooms: [
        makeRoom({
          room_type: "bathroom",
          label: "Bath",
          walls: [
            { direction: "north", features: [] },
            { direction: "south", features: [] },
          ],
        }),
      ],
    });
    const out = formatExtractedFloorPlanForPrompt(plan, "bathroom");
    expect(out).toContain("Walls:\n    (no features noted)");
  });

  it("falls back to a prefix match on room_type (bedroom_master → bedroom)", () => {
    const plan = makePlan({
      rooms: [makeRoom({ room_type: "bedroom", label: "Primary Suite", sqft: 180 })],
    });
    const out = formatExtractedFloorPlanForPrompt(plan, "bedroom_master");
    expect(out).toContain("This bedroom (Primary Suite) — ~180 sqft:");
  });

  it("lists non-primary rooms as one-line summaries with window walls", () => {
    const plan = makePlan({
      rooms: [
        makeRoom({ room_type: "living_room", label: "Living" }),
        makeRoom({
          room_type: "kitchen",
          label: "Kitchen",
          dimensions_text: "8 × 10 ft",
          walls: [
            { direction: "south", features: [{ type: "window", position_on_wall: "center" }] },
          ],
        }),
      ],
    });
    const out = formatExtractedFloorPlanForPrompt(plan, "living_room");
    expect(out).toContain("Other rooms:");
    expect(out).toContain("Kitchen (kitchen) — ~8 × 10 ft; windows on south wall");
  });

  it("shows every room as an 'other room' when no roomType is supplied", () => {
    const plan = makePlan({
      rooms: [
        makeRoom({ room_type: "living_room", label: "Living" }),
        makeRoom({ room_type: "kitchen", label: "Kitchen" }),
      ],
    });
    const out = formatExtractedFloorPlanForPrompt(plan);
    expect(out).not.toContain("This ");
    expect(out).toContain("Living (living_room)");
    expect(out).toContain("Kitchen (kitchen)");
  });

  it("appends overall notes when present", () => {
    const out = formatExtractedFloorPlanForPrompt(
      makePlan({ overall_notes: "open-plan layout, galley kitchen" }),
    );
    expect(out.trimEnd()).toMatch(/Notes: open-plan layout, galley kitchen$/);
  });
});

describe("getRoomFromFloorPlan", () => {
  it("returns undefined for a nullish plan", () => {
    expect(getRoomFromFloorPlan(null, "bedroom")).toBeUndefined();
    expect(getRoomFromFloorPlan(undefined, "bedroom")).toBeUndefined();
  });

  it("returns the exact room_type match", () => {
    const plan = makePlan({
      rooms: [makeRoom({ room_type: "living_room" }), makeRoom({ room_type: "bedroom", label: "BR1" })],
    });
    expect(getRoomFromFloorPlan(plan, "bedroom")?.label).toBe("BR1");
  });

  it("falls back to a prefix match on the first token", () => {
    const plan = makePlan({ rooms: [makeRoom({ room_type: "bedroom", label: "Suite" })] });
    expect(getRoomFromFloorPlan(plan, "bedroom_guest")?.label).toBe("Suite");
  });

  it("returns undefined when nothing matches", () => {
    const plan = makePlan({ rooms: [makeRoom({ room_type: "kitchen" })] });
    expect(getRoomFromFloorPlan(plan, "bathroom")).toBeUndefined();
  });
});
