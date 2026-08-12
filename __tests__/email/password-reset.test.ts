import { describe, expect, it } from "vitest";
import { buildPasswordResetEmail } from "@/lib/email/templates/password-reset";

// password-reset.ts interpolates a server-minted reset link into both an href
// attribute and visible link text with a hand-rolled escapeHtml() — this is
// the account-recovery path (G4), and it had zero direct coverage. The link
// itself is server-minted by Supabase, not attacker-controlled today, but the
// module's own comment says the escaping exists defensively; these tests hold
// that defense to its stated bar rather than trusting it by inspection.

describe("password-reset email template", () => {
  it("carries a fixed, non-account-enumerating subject", () => {
    const { subject } = buildPasswordResetEmail(
      "https://aptdesignerai.com/reset-password?token_hash=x&type=recovery",
    );
    expect(subject).toBe("Reset your AptDesignerAI password");
  });

  it("never claims an account does or doesn't exist (enumeration-safe copy)", () => {
    const { html, text } = buildPasswordResetEmail(
      "https://aptdesignerai.com/reset-password?token_hash=x&type=recovery",
    );
    for (const body of [html, text]) {
      expect(body.toLowerCase()).not.toMatch(/no account|account exists|account not found|no user found/);
    }
  });

  it("renders the reset link verbatim in the plain-text body", () => {
    const url = "https://aptdesignerai.com/reset-password?token_hash=abc123&type=recovery";
    const { text } = buildPasswordResetEmail(url);
    expect(text).toContain(url);
  });

  it("escapes every special character class the URL could carry", () => {
    const url = `https://example.com/?a=1&b=<x>&c="y"&d='z'`;
    const { html } = buildPasswordResetEmail(url);
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("&quot;y&quot;");
    expect(html).toContain("&#39;z&#39;");
    // None of the raw special characters survive unescaped into the HTML.
    expect(html).not.toContain("<x>");
    expect(html).not.toContain('"y"');
    expect(html).not.toContain("'z'");
  });

  it("a crafted attribute-breakout payload cannot escape the href or inject markup", () => {
    const url =
      'https://aptdesignerai.com/reset-password?token_hash="><script>alert(1)</script>&type=recovery';
    const { html } = buildPasswordResetEmail(url);
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("uses the SAME escaped URL for both the button href and the fallback visible link", () => {
    const url = "https://aptdesignerai.com/reset-password?token_hash=abc&type=recovery";
    const { html } = buildPasswordResetEmail(url);
    const safe = "https://aptdesignerai.com/reset-password?token_hash=abc&amp;type=recovery";
    const hrefOccurrences = html.split(`href="${safe}"`).length - 1;
    expect(hrefOccurrences).toBe(2); // the CTA button + the "paste this link" fallback
    expect(html).toContain(`>${safe}<`); // the fallback shows the link as visible text too
  });
});
