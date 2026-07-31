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

/**
 * That paragraph split into its comma-separated ITEMS, lowercased, with any
 * parenthetical aside dropped. Comparing items rather than searching the raw
 * text keeps the assertions from firing on a word used legitimately inside a
 * longer, truthful clause.
 */
function notCollectedItems(doc: string): string[] {
  return notCollectedBlock(doc)
    .replace(/\([^)]*\)/g, "")
    .split(",")
    // trim BEFORE stripping the Oxford "and": split(",") leaves a leading space
    // on every item but the first, so stripping first never matches and the
    // final item stays "and name" — which would silently false-pass the very
    // assertions below.
    .map((item) =>
      item.replace(/\s+/g, " ").trim().replace(/^and\s+/i, "").replace(/\.$/, "").toLowerCase(),
    )
    .filter(Boolean);
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

  it("declares name collection, because signup stores a full name on the profile", () => {
    // Same shape as the location assertion: establish the premise from the
    // schema + the route, then require the disclosure. The signup form's name
    // field is optional, but "optional" is not "not collected".
    const sql = migrationsText();
    expect(/create table profiles[\s\S]{0,400}?full_name/i.test(sql)).toBe(true);
    expect(read("app/api/auth/signup/route.ts")).toMatch(/full_name/);

    // Match LIST ITEMS, not the word anywhere. A bare /\bname\b/ would also fire
    // on a truthful future sentence like "the building name field is stored",
    // which would be a brittle false failure rather than a caught defect.
    expect(notCollectedItems(read(APP_PRIVACY))).not.toContain("name");
  });

  it("does not claim the user content it actually stores is uncollected", () => {
    // Floor plans, free-text room notes and refine-chat messages are all stored,
    // so the blanket exclusions that used to cover them must be gone.
    const sql = migrationsText();
    expect(/rooms[\s\S]{0,200}?user_context/i.test(sql)).toBe(true);
    expect(/create table[\s\S]{0,80}?refine_messages/i.test(sql)).toBe(true);

    const items = notCollectedItems(read(APP_PRIVACY));
    expect(items).not.toContain("messages");
    expect(items.some((i) => /user content beyond room photos/.test(i))).toBe(false);

    // ...and they are positively declared.
    const doc = read(APP_PRIVACY);
    expect(doc.toLowerCase()).toContain("floor plan");
    expect(doc.toLowerCase()).toContain("refine-chat");
    expect(doc.toLowerCase()).toContain("room notes");
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

  /**
   * Both store forms ask about device permissions SEPARATELY from data
   * collection, so a permission the app requests but the artifacts omit is an
   * incomplete attestation even when no new data category is involved. That is
   * exactly how `expo-notifications` went undeclared: it was added to
   * `mobile/app.json` as a plugin, produced no new stored column for the
   * collection-derived assertions above to catch, and `docs/app-privacy.md`
   * went on asserting "the only permission strings are camera and photo
   * library" — a sentence that was true when written.
   *
   * Derived from the plugin list, in the same spirit as the rest of this file:
   * adding a permission-requesting plugin fails this until both artifacts name
   * it, and removing one relaxes the requirement on its own.
   */
  it("declares every device permission the Expo plugin list actually requests", () => {
    const appJson = JSON.parse(read("mobile/app.json")) as {
      expo: { plugins?: (string | [string, unknown])[] };
    };
    const plugins = (appJson.expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));

    // Plugin → the word both artifacts must use for the permission it prompts
    // for. Only plugins that trigger a RUNTIME permission dialog belong here;
    // expo-router/expo-splash-screen prompt for nothing.
    const PERMISSION_PLUGINS: Record<string, RegExp> = {
      "expo-image-picker": /photo library/i,
      "expo-notifications": /notification/i,
      "expo-location": /location permission/i,
      "expo-contacts": /contacts/i,
    };

    const requested = plugins.filter((p) => p in PERMISSION_PLUGINS);
    // The premise: if this ever finds nothing, the plugin list moved or the
    // parse broke, and every assertion below would pass vacuously.
    expect(requested.length, "no permission-requesting Expo plugin found — parse likely broke")
      .toBeGreaterThan(0);

    for (const plugin of requested) {
      for (const rel of [APP_PRIVACY, PRIVACY_PAGE]) {
        expect(
          PERMISSION_PLUGINS[plugin].test(read(rel)),
          `${rel} must declare the permission that ${plugin} requests`,
        ).toBe(true);
      }
    }
  });

  /**
   * The push token is the one piece of notification data that could become a
   * declarable identifier. It is not declared today because it never leaves the
   * device — so this pins that PREMISE rather than the conclusion: the day a
   * caller sends the token to a server, this fails and the forms get revisited.
   */
  it("keeps the push token on-device, which is why no Device ID is declared", () => {
    const hook = read("mobile/src/hooks/use-push-notifications.ts");
    expect(hook, "the token must still be persisted locally").toContain("AsyncStorage.setItem");
    // No network call in the module that obtains the token.
    expect(hook).not.toMatch(/\bfetch\s*\(|apiFetch|axios/);

    // Anchor on the push-token passage itself and read only that window. A
    // document-wide search for a phrase like "not collected" passes on the
    // unrelated "**Not collected:**" paragraph this file already parses
    // elsewhere — which it did, on the exact revision that had no push-token
    // disclosure at all.
    const doc = read(APP_PRIVACY);
    const at = doc.search(/push token/i);
    expect(at, `${APP_PRIVACY} must have a push-token passage`).toBeGreaterThan(-1);
    const passage = doc.slice(at, at + 900).replace(/\s+/g, " ");
    expect(
      /not\b[^.]{0,60}declared|never leaves the device|nothing sends it/i.test(passage),
      `${APP_PRIVACY} must explain why the push token is not declared as an identifier`,
    ).toBe(true);
  });
});
