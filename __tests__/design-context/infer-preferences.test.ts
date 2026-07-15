import { describe, it, expect } from "vitest";
import {
  aggregatePreferenceSignals,
  formatPreferencesForPrompt,
  EMPTY_PREFERENCE_SIGNALS,
} from "@/lib/design-context/infer-preferences";

function makeRoom(opts: {
  id: string;
  roomType?: string;
  keep_items?: string[];
  replace_items?: string[];
  priorities?: string[];
  user_context?: string | null;
  budget_mode?: string | null;
  diagnoses?: Array<{
    design_direction_json?: {
      recommended_palette?: string[];
      recommended_materials?: string[];
      style_notes?: string;
    } | null;
    action_list?: Array<{ category: string; action: string; priority: number; reasoning: string }> | null;
    created_at?: string;
  }>;
}) {
  return {
    id: opts.id,
    room_type: opts.roomType ?? "living_room",
    keep_items: opts.keep_items ?? [],
    replace_items: opts.replace_items ?? [],
    priorities: opts.priorities ?? [],
    user_context: opts.user_context ?? null,
    budget_mode: opts.budget_mode ?? null,
    room_diagnoses: (opts.diagnoses ?? []).map((d) => ({
      id: "dx",
      room_id: opts.id,
      diagnosis_json: {} as never,
      design_direction_json: d.design_direction_json ?? null,
      missing_categories: null,
      action_list: d.action_list ?? null,
      model_used: null,
      created_at: d.created_at ?? "2026-01-01T00:00:00Z",
    })) as unknown as never,
  };
}

describe("aggregatePreferenceSignals", () => {
  it("returns EMPTY_PREFERENCE_SIGNALS when no sibling rooms exist", () => {
    const result = aggregatePreferenceSignals([makeRoom({ id: "current" })], "current");
    expect(result).toEqual(EMPTY_PREFERENCE_SIGNALS);
  });

  it("aggregates keep_items and replace_items across siblings", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        keep_items: ["walnut dresser", "sheepskin rug"],
        replace_items: ["glass coffee table"],
      }),
      makeRoom({
        id: "office",
        keep_items: ["walnut dresser", "oak desk"],
        replace_items: ["glass coffee table", "chrome lamp"],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");

    // walnut dresser appears twice → top of preferred_items
    expect(result.preferred_items[0].toLowerCase()).toContain("walnut dresser");
    // glass coffee table appears twice → top of avoided_items
    expect(result.avoided_items[0].toLowerCase()).toContain("glass");
    expect(result.source_room_count).toBe(2);
  });

  it("infers minimalist density from low average item counts", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        diagnoses: [{
          action_list: Array.from({ length: 6 }, (_, i) => ({
            category: `c${i}`, action: "", priority: 3, reasoning: "",
          })),
        }],
      }),
      makeRoom({
        id: "office",
        diagnoses: [{
          action_list: Array.from({ length: 8 }, (_, i) => ({
            category: `c${i}`, action: "", priority: 3, reasoning: "",
          })),
        }],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    expect(result.density_preference).toBe("minimalist");
  });

  it("infers maximalist density from high average item counts", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        diagnoses: [{
          action_list: Array.from({ length: 22 }, (_, i) => ({
            category: `c${i}`, action: "", priority: 3, reasoning: "",
          })),
        }],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    expect(result.density_preference).toBe("maximalist");
  });

  it("infers tight budget pressure when majority of rooms are budget tier", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({ id: "a", budget_mode: "budget" }),
      makeRoom({ id: "b", budget_mode: "budget" }),
      makeRoom({ id: "c", budget_mode: "balanced" }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    expect(result.budget_pressure).toBe("tight");
  });

  it("aggregates recurring_categories from latest diagnosis per sibling", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        diagnoses: [{
          action_list: [
            { category: "bed", action: "", priority: 1, reasoning: "" },
            { category: "nightstand", action: "", priority: 2, reasoning: "" },
            { category: "plants", action: "", priority: 4, reasoning: "" },
          ],
        }],
      }),
      makeRoom({
        id: "office",
        diagnoses: [{
          action_list: [
            { category: "desk", action: "", priority: 1, reasoning: "" },
            { category: "plants", action: "", priority: 4, reasoning: "" },
          ],
        }],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    // plants appears twice → should be in recurring_categories
    expect(result.recurring_categories).toContain("plants");
  });

  it("uses the LATEST diagnosis per sibling room (by created_at)", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        diagnoses: [
          {
            created_at: "2026-01-01T00:00:00Z",
            action_list: [{ category: "old_stuff", action: "", priority: 1, reasoning: "" }],
          },
          {
            created_at: "2026-06-01T00:00:00Z",
            action_list: [{ category: "new_stuff", action: "", priority: 1, reasoning: "" }],
          },
        ],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    expect(result.recurring_categories).toContain("new_stuff");
    expect(result.recurring_categories).not.toContain("old_stuff");
  });

  it("breaks frequency ties alphabetically so the top-N slice is reproducible", () => {
    // Ten distinct palette colours, each appearing exactly once, fed in a
    // deliberately non-alphabetical order. The n=8 slice must be the eight
    // alphabetically-first colours IN alphabetical order — NOT the first eight
    // in input order. This pins the determinism-contract tiebreaker: a
    // count-only sort would leave the truncation to input/engine ordering.
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        diagnoses: [
          {
            design_direction_json: {
              recommended_palette: [
                "zinc", "yellow", "amber", "teal", "blue",
                "green", "red", "orange", "violet", "brown",
              ],
            },
          },
        ],
      }),
    ];
    const result = aggregatePreferenceSignals(rooms, "current");
    expect(result.preferred_palette).toEqual([
      "amber", "blue", "brown", "green", "orange", "red", "teal", "violet",
    ]);
  });
});

describe("formatPreferencesForPrompt", () => {
  it("returns null for empty / no source signals", () => {
    expect(formatPreferencesForPrompt(null)).toBeNull();
    expect(formatPreferencesForPrompt(undefined)).toBeNull();
    expect(formatPreferencesForPrompt(EMPTY_PREFERENCE_SIGNALS)).toBeNull();
  });

  it("renders a preference block with headers when signals exist", () => {
    const rooms = [
      makeRoom({ id: "current" }),
      makeRoom({
        id: "bedroom",
        keep_items: ["oak dresser"],
        replace_items: ["glass coffee table"],
        diagnoses: [{
          design_direction_json: {
            recommended_palette: ["warm walnut", "ivory"],
            recommended_materials: ["oak", "linen"],
            style_notes: "Japandi with soft wood",
          },
          action_list: [{ category: "plants", action: "", priority: 4, reasoning: "" }],
        }],
      }),
    ];
    const signals = aggregatePreferenceSignals(rooms, "current");
    const block = formatPreferencesForPrompt(signals);

    expect(block).toContain("User Preference Signals");
    expect(block).toContain("oak dresser");
    expect(block).toContain("glass coffee table");
    expect(block).toContain("walnut");
    expect(block).toContain("oak");
  });
});
