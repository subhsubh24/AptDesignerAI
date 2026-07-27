import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A store privacy declaration that does not match the code is a review-blocking
 * defect (Apple App Privacy and Play Data Safety are both attestations), and it
 * is the failure mode nobody notices: the form is filled in once, the schema
 * grows, and the two silently diverge.
 *
 * So these assertions are DERIVED FROM SOURCE, not from a hand-kept list. Each
 * one first establishes from the code that a thing is collected, and only then
 * requires the artifacts to say so. If the collection is ever removed, the
 * corresponding requirement relaxes on its own rather than becoming a stale
 * assertion of its own.
 */

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const APP_PRIVACY = "docs/app-privacy.md";
const PRIVACY_PAGE = "app/privacy/page.tsx";

function migrationsText(): string {
  const dir = path.join(root, "supabase/migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

/**
 * The prose describing the Google Maps/Places processor.
 *
 * Deliberately a CHARACTER window, not a line filter: in the JSX page the
 * `<strong>Google Maps / Places</strong>` label and the sentence describing it
 * are on different source lines, so a per-line match would read the label and
 * miss the claim — passing vacuously on exactly the text this test exists to
 * catch. Whitespace is collapsed so a line break inside the claim can't hide it
 * from the regex either.
 */
function mapsDisclosure(text: string, rel: string): string {
  const at = text.search(/Google\s*\(?Maps\s*\/?\s*Places/i);
  expect(at, `${rel} must disclose Google Maps/Places`).toBeGreaterThan(-1);
  return text.slice(at, at + 500).replace(/\s+/g, " ");
}

/** The "Not collected:" paragraph of the App Privacy doc. */
function notCollectedBlock(doc: string): string {
  const match = doc.match(/\*\*Not collected:\*\*([\s\S]*?)\n\n/);
  expect(match, `${APP_PRIVACY} must keep a "**Not collected:**" paragraph`).toBeTruthy();
  return match![1];
}

describe("privacy artifacts match what the code actually collects", () => {
  it("declares location collection, because projects store building coordinates", () => {
    const sql = migrationsText();
    const storesCoordinates = /alter table projects[\s\S]{0,400}?latitude/i.test(sql);
    const storesAddressParts = /alter table projects[\s\S]{0,400}?(city|neighborhood|building_name)/i.test(
      sql,
    );

    // Establish the premise from the schema first. If a future change drops
    // these columns, this test stops demanding the disclosure.
    expect(
      storesCoordinates && storesAddressParts,
      "expected supabase/migrations to add latitude/longitude and address columns to projects",
    ).toBe(true);

    const doc = read(APP_PRIVACY);
    const notCollected = notCollectedBlock(doc);

    // The exact false declaration this test exists to prevent.
    expect(notCollected).not.toMatch(/\bprecise or coarse location\b/i);
    expect(notCollected).not.toMatch(/\bphysical address\b/i);

    // ...and the positive side: it must appear as collected in both the Apple
    // and the Play section.
    expect(doc).toMatch(/Location\s*(→|->)?\s*Precise Location|Precise Location/i);
    expect(doc).toMatch(/Physical Address/i);

    // The user-facing page must say it too, not only the store-form doc.
    const page = read(PRIVACY_PAGE);
    expect(page.toLowerCase()).toMatch(/neighbourhood|neighborhood/);
    expect(page.toLowerCase()).toMatch(/coordinates/);
  });

  it("does not describe Google Maps/Places as product-image search when it powers address autocomplete", () => {
    // Premise: an address autocomplete component exists and the dashboard uses it.
    const autocompletePath = "components/ui/place-autocomplete.tsx";
    expect(fs.existsSync(path.join(root, autocompletePath))).toBe(true);
    expect(read("app/dashboard/page.tsx")).toContain("place-autocomplete");

    for (const rel of [APP_PRIVACY, PRIVACY_PAGE]) {
      expect(mapsDisclosure(read(rel), rel)).not.toMatch(/product\s+(image\s+)?search/i);
    }
  });

  it("discloses that the Places script loads on every page, while it does", () => {
    const layout = read("app/layout.tsx");
    const loadsGloballly = layout.includes("maps.googleapis.com");
    if (!loadsGloballly) return; // premise gone — nothing to require

    for (const rel of [APP_PRIVACY, PRIVACY_PAGE]) {
      expect(
        /every page/i.test(read(rel)),
        `${rel} must disclose that Google's Places script loads on every page`,
      ).toBe(true);
    }
  });

  it("keeps the deletion promise honest — deletion must purge storage, not just rows", () => {
    // The page promises deletion "permanently removes all your content". That is
    // only true because the delete routes purge object storage; if that call is
    // ever dropped, the promise becomes false and this fails.
    const page = read(PRIVACY_PAGE);
    expect(page).toMatch(/permanently removes all your content/i);

    for (const route of ["app/api/user/delete/route.ts", "app/api/mobile/account/route.ts"]) {
      expect(read(route), `${route} must purge stored objects before deleting the account`).toContain(
        "purgeUserStorage",
      );
    }
  });
});
