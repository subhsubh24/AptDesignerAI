import { describe, it, expect } from "vitest";
import {
  compareVerifyPriority,
  cropSortKey,
} from "@/lib/agents/identified-products-pipeline";
import type { FurnitureCrop } from "@/lib/agents/furniture-cropper";

// The verify phase sorts crops by top-candidate confidence and drops the tail
// once maxVerifyCalls is reached, so the ORDER of equal-confidence crops decides
// which products actually get verified. These tests lock in that the order is a
// pure function of the crop SET, not the identify fan-out's insertion order.

function crop(label: string, x: number): FurnitureCrop {
  return {
    source_image_url: `https://img/${label}.jpg`,
    label,
    box: { x, y: 0, w: 0.1, h: 0.1 },
  };
}

type Item = {
  crop: Pick<FurnitureCrop, "source_image_url" | "label" | "box">;
  top: { confidence: number } | null;
};

const item = (label: string, x: number, confidence: number | null): Item => ({
  crop: crop(label, x),
  top: confidence === null ? null : { confidence },
});

const order = (items: Item[]) =>
  [...items].sort(compareVerifyPriority).map((i) => i.crop.label);

describe("compareVerifyPriority", () => {
  it("sorts by top-candidate confidence descending", () => {
    const items = [item("sofa", 0.1, 0.4), item("lamp", 0.2, 0.9), item("rug", 0.3, 0.6)];
    expect(order(items)).toEqual(["lamp", "rug", "sofa"]);
  });

  it("breaks confidence ties by the stable crop key, independent of input order", () => {
    // All three share confidence 0.5 (the identification default), so only the
    // tiebreak decides who wins the verify budget. Two different input orderings
    // MUST yield the same output — this is the property that fails without the
    // crop-key tiebreak (JS stable sort would preserve input order).
    const a = item("alpha", 0.1, 0.5);
    const b = item("bravo", 0.2, 0.5);
    const c = item("charlie", 0.3, 0.5);
    expect(order([a, b, c])).toEqual(order([c, a, b]));
    expect(order([b, c, a])).toEqual(order([a, b, c]));
  });

  it("keeps confidence dominant over the tiebreak", () => {
    // Higher confidence wins even when its crop key sorts later alphabetically.
    const items = [item("zzz", 0.1, 0.9), item("aaa", 0.2, 0.4)];
    expect(order(items)).toEqual(["zzz", "aaa"]);
  });

  it("treats a null top candidate as confidence 0 (sinks to the end)", () => {
    const items = [item("empty", 0.1, null), item("real", 0.2, 0.3)];
    expect(order(items)).toEqual(["real", "empty"]);
  });
});

describe("cropSortKey", () => {
  it("distinguishes crops by image, label, and box", () => {
    expect(cropSortKey(crop("sofa", 0.1))).not.toBe(cropSortKey(crop("sofa", 0.2)));
    expect(cropSortKey(crop("sofa", 0.1))).not.toBe(cropSortKey(crop("lamp", 0.1)));
  });

  it("is stable for the same crop", () => {
    expect(cropSortKey(crop("sofa", 0.1))).toBe(cropSortKey(crop("sofa", 0.1)));
  });
});
