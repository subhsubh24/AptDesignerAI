// Resend email provider.
//
// Uses Resend's REST API directly (https://resend.com/docs/api-reference/emails/send-email)
// over fetch — no SDK dependency. The live API key is owner-supplied and read
// from the environment at construction time; it is never committed.

import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const payload: Record<string, unknown> = {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    };
    if (message.text) payload.text = message.text;
    if (message.replyTo) payload.reply_to = message.replyTo;

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // Lifecycle emails fire from the request path (e.g. the Stripe webhook).
        // A stalled provider connection must not hold the function open — time
        // out at 10s and surface a clean "unreachable" result via the catch.
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        // Log status only — the provider error body can contain the recipient
        // address and other PII, so it must not land in the log aggregator.
        console.error(`[email:resend] send failed: ${res.status} ${res.statusText}`);
        return { delivered: false, dryRun: false, error: `Email provider returned ${res.status}` };
      }

      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (!data.id) {
        console.warn("[email:resend] send accepted but no message id was returned");
      }
      return { delivered: true, dryRun: false, id: data.id };
    } catch (err) {
      console.error("[email:resend] network error:", err);
      return { delivered: false, dryRun: false, error: "Email provider unreachable" };
    }
  }
}
