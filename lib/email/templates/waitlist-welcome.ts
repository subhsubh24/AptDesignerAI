// Waitlist welcome email — fires once, right after double opt-in confirmation
// (E7.1 -> E7.2). This is "Email 1" of the welcome sequence in
// docs/email-welcome-sequence.md; it confirms the subscriber is on the list and
// sets expectations for launch. Copy is grounded only in what the product
// actually does (no invented metrics, no emoji, calm-warm tone — matches the
// sequence doc). Keep in sync with docs/email-welcome-sequence.md Email 1.

export interface WaitlistWelcomeEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the welcome email sent once a waitlist sign-up is confirmed. Takes no
 * user-influenced input, so there is nothing to escape — the body is static.
 */
export function buildWaitlistWelcomeEmail(): WaitlistWelcomeEmail {
  const subject = "You're on the list — here's what's coming";

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2722;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ece5db;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:36px 36px 8px 36px;">
                <p style="margin:0 0 4px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#b07a4f;font-weight:600;">AptDesignerAI</p>
                <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:700;color:#2b2722;">You're on the early-access list</h1>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  Thanks for confirming. You're set for early access to AptDesignerAI —
                  an AI that reads your apartment photos and tells you exactly what to
                  do with them. Here's what to expect at launch:
                </p>
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  <strong style="color:#2b2722;">On your phone.</strong> Point your camera
                  at any room. In about 30 seconds you'll have a design direction
                  (palette, materials, style notes), a read on what's working and what
                  isn't, and product recommendations scored against your actual space.
                </p>
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  <strong style="color:#2b2722;">Honest recommendations.</strong> Every
                  furniture pick is scored for scale against your room dimensions,
                  palette compatibility, and style coherence — you see the reasoning,
                  not just a product card.
                </p>
                <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  <strong style="color:#2b2722;">The whole apartment.</strong> Design
                  rooms in any order. The AI keeps a shared style thread, so your
                  bedroom doesn't end up looking like a different apartment from your
                  living room.
                </p>
                <p style="margin:0 0 8px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  We'll email you the moment the app is live on the App Store and
                  Google Play.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 36px 32px 36px;border-top:1px solid #ece5db;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#a39a8f;">
                  You're receiving this because you confirmed your spot on the
                  AptDesignerAI waitlist. We'll only email you about the launch.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "You're on the list — here's what's coming",
    "",
    "Thanks for confirming. You're set for early access to AptDesignerAI — an AI",
    "that reads your apartment photos and tells you exactly what to do with them.",
    "",
    "What to expect at launch:",
    "- On your phone: point your camera at any room. In ~30 seconds you'll have a",
    "  design direction (palette, materials, style notes), a read on what's working",
    "  and what isn't, and product recommendations scored against your actual space.",
    "- Honest recommendations: every pick is scored for scale, palette compatibility,",
    "  and style coherence — you see the reasoning, not just a product card.",
    "- The whole apartment: design rooms in any order; the AI keeps a shared style",
    "  thread across them.",
    "",
    "We'll email you the moment the app is live on the App Store and Google Play.",
  ].join("\n");

  return { subject, html, text };
}
