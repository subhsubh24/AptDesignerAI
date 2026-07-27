import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // sitemap.xml and robots.txt are excluded for the same reason the _next and
    // image assets are: they are static crawler-facing files, not app routes.
    // Without the exclusion the session middleware treats them as protected
    // paths and 307s an (always logged-out) crawler to /login, which would make
    // both files unreachable to the only clients that ever request them.
    // Anchored with `$` and with the dots escaped, unlike the older
    // `favicon.ico` alternative: an unanchored literal only has to PREFIX-match
    // the path, so a bare `sitemap.xml` would also exclude a future
    // `/sitemap.xml-preview` (and the unescaped `.` would match any character),
    // silently skipping auth, CORS and the site gate for it.
    //
    // `opengraph-image` is excluded for exactly the same reason, and it is not
    // theoretical: Next serves the generated card at `/opengraph-image` and
    // `/<segment>/opengraph-image`, which are NOT in PUBLIC_PATHS, so without
    // this every social crawler — all of which are logged out — would be 307'd
    // to /login and every link preview on the site would be blank. Pre-launch it
    // would also meet the site gate, breaking previews of the waitlist page the
    // funnel depends on.
    //
    // ENUMERATED, not suffix-matched. An open `.*opengraph-image$` would exempt
    // any path ENDING in that literal at ANY depth — and `/api/projects/
    // opengraph-image` is a REAL route (`app/api/projects/[projectId]`), which
    // would then skip auth, CORS and the site gate with the segment bound to
    // "opengraph-image". Not exploitable today (ids are uuid/random-hex, and
    // each handler re-checks auth itself), but a security matcher must not rest
    // on an id scheme elsewhere staying unguessable — that is the same
    // discipline the `sitemap\.xml$` anchoring above exists for. So the
    // alternation lists the og-image routes that ACTUALLY exist; extend it when
    // a new per-route override is added.
    //
    // Safe to exempt: the card renders from static brand strings only and never
    // reads user data (see lib/og/brand-card.tsx).
    "/((?!_next/static|_next/image|favicon.ico|(?:sitemap\\.xml|robots\\.txt)$|(?:waitlist/)?opengraph-image$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
