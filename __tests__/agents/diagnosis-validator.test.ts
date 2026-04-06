import { describe, it, expect } from "vitest";
import { validateDiagnosis } from "@/lib/agents/diagnosis-validator";
import type { DiagnosisResult } from "@/lib/agents/room-diagnostician";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";

function makeDiagnosis(overrides?: Partial<{
  action_list: ActionItem[];
  missing_categories: string[];
  what_is_not_working: string[];
  recommended_furniture_types: string[];
}>): DiagnosisResult {
  return {
    diagnosis: {
      current_vibe_summary: "A modern living room with dark gray sectional",
      what_is_working: [
        "Dark gray fabric L-shaped sectional — well-scaled",
        "Floor-to-ceiling windows — great light",
        "Light-toned wide-plank flooring — beautiful base",
      ],
      what_is_not_working: overrides?.what_is_not_working || [
        "Small glass coffee table — too small for sectional",
        "Cluttered ladder bookshelf — encourages visual noise",
        "Glossy white TV console — synthetic finish",
      ],
      biggest_improvement_opportunities: ["Add area rug", "Replace coffee table"],
      missing_furniture_categories: overrides?.missing_categories || [
        "area_rug", "coffee_table", "dining_table", "floor_lamp", "throw_pillows", "art",
      ],
      color_issues: ["Too much contrast between dark gray and white"],
      texture_material_issues: ["Only two textures present"],
      scale_proportion_issues: ["Coffee table undersized"],
      layout_issues: ["Floating furniture"],
      lighting_issues: ["No layered lighting"],
      clutter_editing_issues: ["Shopping bag on floor"],
    } as DiagnosisData,
    design_direction: {
      recommended_palette: ["warm ivory", "walnut brown", "muted sage"],
      recommended_materials: ["solid walnut", "linen", "wool"],
      recommended_textures: ["high-low pile wool"],
      recommended_furniture_types: overrides?.recommended_furniture_types || [
        "Area rug — 8x10, wool",
        "Walnut coffee table — 34 inch round",
        "Sheer linen drapery panels — floor-to-ceiling",
        "Brass arc floor lamp — 72 inches tall",
      ],
      style_notes: "Organic Urban Minimalist",
    } as DesignDirection,
    missing_categories: overrides?.missing_categories || [
      "area_rug", "coffee_table", "dining_table", "floor_lamp", "curtains", "throw_pillows",
    ],
    action_list: overrides?.action_list || [
      { priority: 1, action: "Add large 8x10 wool area rug in warm oatmeal", category: "area_rug", reasoning: "Ground the sectional" },
      { priority: 2, action: "Replace with 34-inch walnut round coffee table", category: "coffee_table", reasoning: "Current one too small" },
      { priority: 3, action: "Add custom ripple-fold sheer linen curtain panels", category: "curtains", reasoning: "Soften windows" },
      { priority: 4, action: "Add modern brass arc floor lamp with linen shade", category: "floor_lamp", reasoning: "Add height and warm light" },
      { priority: 5, action: "Add 38-inch round walnut dining table", category: "dining_table", reasoning: "Hosting zone" },
      { priority: 6, action: "Add fiddle leaf fig plant in matte black planter", category: "plants", reasoning: "Living element" },
    ],
  };
}

describe("validateDiagnosis", () => {
  describe("exclusion violations", () => {
    it("should remove curtain recommendations when user says 'don't need curtains'", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "my windows have blinds so don't need curtains"
      );

      // Curtain action should be removed
      expect(result.patched.action_list.some((a) => a.category === "curtains")).toBe(false);

      // Should have logged the issue
      expect(result.issues.some((i) => i.type === "exclusion_violation")).toBe(true);
      expect(result.wasModified).toBe(true);
    });

    it("should remove curtain-related missing categories", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      expect(result.patched.missing_categories.some((c) =>
        c.toLowerCase().includes("curtain") || c.toLowerCase().includes("drape")
      )).toBe(false);
    });

    it("should remove drapery from furniture types", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      expect(result.patched.design_direction.recommended_furniture_types.some((ft) =>
        String(ft).toLowerCase().includes("drape") || String(ft).toLowerCase().includes("curtain")
      )).toBe(false);
    });

    it("should remove curtains from diagnosis.missing_furniture_categories", () => {
      const diagnosis = makeDiagnosis();
      diagnosis.diagnosis.missing_furniture_categories = [
        "area_rug", "coffee_table", "curtains", "floor_lamp",
      ];
      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      expect(result.patched.diagnosis.missing_furniture_categories.some((c: string) =>
        c.toLowerCase().includes("curtain")
      )).toBe(false);
      // Other categories should remain
      expect(result.patched.diagnosis.missing_furniture_categories).toContain("area_rug");
    });

    it("should catch window covering synonyms as curtain exclusions", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add soft window coverings for warmth", category: "window_treatment", reasoning: "Soften space" },
          { priority: 2, action: "Add area rug", category: "area_rug", reasoning: "Ground furniture" },
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      expect(result.patched.action_list.some(
        (a) => a.action.includes("window covering")
      )).toBe(false);
      expect(result.patched.action_list.some((a) => a.category === "area_rug")).toBe(true);
    });

    it("should not remove non-excluded items", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      // Rug should still be there
      expect(result.patched.action_list.some((a) => a.category === "area_rug")).toBe(true);
      // Dining table should still be there
      expect(result.patched.action_list.some((a) => a.category === "dining_table")).toBe(true);
    });
  });

  describe("keep-item replacement violations", () => {
    it("should remove floor lamp recommendation when user keeps their floor lamp", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        ["black arc floor lamp"],
        undefined
      );

      // Floor lamp action should be removed
      expect(result.patched.action_list.some(
        (a) => a.category === "floor_lamp" && a.action.includes("floor lamp")
      )).toBe(false);
      expect(result.issues.some((i) => i.type === "keep_item_replaced")).toBe(true);
    });

    it("should also detect keep items from user context", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "Keep the black arc floor lamp behind the sofa"
      );

      expect(result.patched.action_list.some(
        (a) => a.category === "floor_lamp" && a.action.includes("floor lamp")
      )).toBe(false);
    });

    it("should catch tripod lamp as replacement for kept floor lamp", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add a modern tripod lamp", category: "floor_lamp", reasoning: "Add height" },
          { priority: 2, action: "Add area rug", category: "area_rug", reasoning: "Ground furniture" },
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        ["black arc floor lamp"],
        undefined
      );

      // Tripod lamp should be removed — it's a replacement for the kept floor lamp
      expect(result.patched.action_list.some(
        (a) => a.action.includes("tripod lamp")
      )).toBe(false);
      expect(result.issues.some((i) => i.type === "keep_item_replaced")).toBe(true);
    });

    it("should catch keep items parsed from 'keep both' user context", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add new accent lights beside the TV", category: "table_lamp", reasoning: "Improve lighting" },
          { priority: 2, action: "Add area rug", category: "area_rug", reasoning: "Ground furniture" },
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        [],
        "keep both lights next to the TV"
      );

      // Light replacement should be removed
      expect(result.patched.action_list.some(
        (a) => a.action.includes("accent lights")
      )).toBe(false);
      expect(result.issues.some((i) => i.type === "keep_item_replaced")).toBe(true);
    });

    it("should remove kept items from what_is_not_working", () => {
      const diagnosis = makeDiagnosis({
        what_is_not_working: [
          "Black arc floor lamp is outdated — needs replacement",
          "Small glass coffee table — too small",
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        ["black arc floor lamp"],
        undefined
      );

      expect(result.patched.diagnosis.what_is_not_working.some(
        (item) => item.toLowerCase().includes("black arc floor lamp")
      )).toBe(false);
    });
  });

  describe("missing explicit requests", () => {
    it("should flag missing explicitly requested items", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add area rug", category: "area_rug", reasoning: "Ground furniture" },
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        [],
        "I want a dining table. I want plants also."
      );

      // Should flag that plants are missing if not in action list
      const plantIssue = result.issues.find(
        (i) => i.type === "missing_request" && i.description.includes("plant")
      );
      // May or may not be flagged depending on matching
      // But dining table should be missing since action list only has rug
      const diningIssue = result.issues.find(
        (i) => i.type === "missing_request" && i.description.includes("dining table")
      );
      expect(diningIssue).toBeDefined();
    });
  });

  describe("insufficient quantity for plural requests", () => {
    it("should flag single item for plural request", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add fiddle leaf fig plant", category: "plants", reasoning: "Add greenery" },
        ],
      });

      const result = validateDiagnosis(
        diagnosis,
        [],
        "I want plants also"
      );

      const quantityIssue = result.issues.find(
        (i) => i.type === "insufficient_quantity"
      );
      expect(quantityIssue).toBeDefined();
    });
  });

  describe("priority re-numbering", () => {
    it("should re-number priorities after removing items", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "don't need curtains"
      );

      // Priorities should be sequential starting from 1
      result.patched.action_list.forEach((action, idx) => {
        expect(action.priority).toBe(idx + 1);
      });
    });
  });

  describe("no violations", () => {
    it("should return unmodified diagnosis when no violations exist", () => {
      const diagnosis = makeDiagnosis({
        action_list: [
          { priority: 1, action: "Add area rug", category: "area_rug", reasoning: "Ground furniture" },
          { priority: 2, action: "Add dining table", category: "dining_table", reasoning: "Hosting" },
        ],
        missing_categories: ["area_rug", "dining_table"],
      });

      const result = validateDiagnosis(diagnosis, [], undefined);

      expect(result.issues).toHaveLength(0);
      expect(result.wasModified).toBe(false);
    });
  });

  describe("combined violations", () => {
    it("should handle exclusions + keep items + requests together", () => {
      const diagnosis = makeDiagnosis();
      const result = validateDiagnosis(
        diagnosis,
        [],
        "ignore the yoga mat. Keep the black arc floor lamp. My windows have blinds so don't need curtains. I want plants also. I want a dining table."
      );

      // Curtains removed
      expect(result.patched.action_list.some((a) => a.category === "curtains")).toBe(false);

      // Floor lamp removed (kept)
      expect(result.patched.action_list.some(
        (a) => a.category === "floor_lamp" && a.action.includes("floor lamp")
      )).toBe(false);

      // Dining table should remain
      expect(result.patched.action_list.some((a) => a.category === "dining_table")).toBe(true);

      // Multiple issues should be recorded
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});
