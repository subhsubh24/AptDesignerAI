// Password-reset email (G4 — account recovery).
//
// TRANSACTIONAL: sent only in direct response to a reset request the recipient
// just submitted. No promotional content, no unsubscribe/physical-address
// footer (see TRANSACTIONAL_STAGES in lib/email/index.ts) — a locked-out user
// must never have their only way back in suppressed by a marketing gate.
//
// The link is minted server-side by Supabase (admin generateLink, type
// "recovery"); this module only renders it. Copy stays factual: it never claims
// an account exists, because the route sends the same neutral response either
// way (enumeration-safe).

export interface PasswordResetEmail {
  subject: string;
  html: string;
  text: string;
}

// The action link is built by Supabase from a trusted origin, but it is
// interpolated into both an href attribute and body text, so escape defensively
// — a crafted value must never break out of the attribute or inject markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the password-reset email.
 * @param resetUrl absolute https recovery link (Supabase action_link).
 */
export function buildPasswordResetEmail(resetUrl: string): PasswordResetEmail {
  const safeUrl = escapeHtml(resetUrl);
  const subject = "Reset your AptDesignerAI password";

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
                <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:700;color:#2b2722;">Set a new password</h1>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#4a443c;">
                  Someone asked to reset the password for this address. Use the button
                  below to choose a new one — the link works once and expires in about
                  an hour.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 36px 32px 36px;">
                <a href="${safeUrl}" style="display:inline-block;background:#b07a4f;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:12px;">Choose a new password</a>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#8a8178;">
                  If the button doesn't work, paste this link into your browser:<br />
                  <a href="${safeUrl}" style="color:#b07a4f;word-break:break-all;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 32px 36px;border-top:1px solid #ece5db;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#a39a8f;">
                  If you didn't ask for this, you can ignore this email — your password
                  stays exactly as it is until the link above is used.
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
    "Set a new password",
    "",
    "Someone asked to reset the password for this address. Open the link below to",
    "choose a new one — it works once and expires in about an hour.",
    "",
    resetUrl,
    "",
    "If you didn't ask for this, ignore this email — your password stays as it is.",
  ].join("\n");

  return { subject, html, text };
}
