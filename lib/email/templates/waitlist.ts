// Waitlist double opt-in confirmation email (E7.1).
//
// Rendered server-side and sent through lib/email when someone joins the
// waitlist. The single call-to-action is the confirmation link — until it is
// clicked the address stays unconfirmed and receives no further mail. Copy is
// grounded only in what the product actually does (no invented metrics).

export interface WaitlistConfirmEmail {
  subject: string;
  html: string;
  text: string;
}

// Minimal HTML escaping for the one piece of user-influenced text we interpolate
// (the confirm URL is built server-side from a hex token + trusted origin, but
// we escape defensively so a crafted value can never break out of the attribute
// or inject markup into the body).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the confirmation email for a pending waitlist sign-up.
 * @param confirmUrl absolute https URL to the confirm endpoint, including token.
 */
export function buildWaitlistConfirmEmail(confirmUrl: string): WaitlistConfirmEmail {
  const safeUrl = escapeHtml(confirmUrl);
  const subject = "Confirm your spot on the AptDesignerAI waitlist";

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
                <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:700;color:#2b2722;">One click and you're on the list</h1>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  Thanks for your interest in AptDesignerAI — the app that reads a photo of
                  your room and gives you a real design direction in about 30 seconds:
                  what's working, what to change, and products that actually fit the space.
                </p>
                <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  Confirm your email so we can let you know the moment the iOS and Android
                  apps go live. (We ask once so we never email an address that didn't
                  opt in.)
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 36px 32px 36px;">
                <a href="${safeUrl}" style="display:inline-block;background:#b07a4f;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:12px;">Confirm my spot</a>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#8a8178;">
                  If the button doesn't work, paste this link into your browser:<br />
                  <a href="${safeUrl}" style="color:#b07a4f;word-break:break-all;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 32px 36px;border-top:1px solid #ece5db;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#a39a8f;">
                  You're receiving this because someone entered this address on the
                  AptDesignerAI waitlist. If that wasn't you, ignore this email and you
                  won't hear from us again — nothing happens until the link is clicked.
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
    "Confirm your spot on the AptDesignerAI waitlist",
    "",
    "Thanks for your interest in AptDesignerAI — the app that reads a photo of your",
    "room and gives you a real design direction in about 30 seconds.",
    "",
    "Confirm your email so we can let you know when the iOS and Android apps launch:",
    confirmUrl,
    "",
    "If that wasn't you, ignore this email — nothing happens until the link is clicked.",
  ].join("\n");

  return { subject, html, text };
}
