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
    "/((?!_next/static|_next/image|favicon.ico|(?:sitemap\\.xml|robots\\.txt)$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
