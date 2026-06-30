// Email send entry point — one abstraction the whole growth engine sends through.
//
// Default behaviour is DRY-RUN: until the owner supplies RESEND_API_KEY, every
// send is logged and acknowledged but nothing leaves the system. This keeps the
// staged E4/E6 email lifecycle safe to wire up and exercise before any channel
// is connected (see docs/growth/CONNECT.md). Live secrets are human-applied.

import { ResendProvider } from "./resend";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

export type { EmailMessage, EmailProvider, EmailSendResult, EmailStage } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const DEFAULT_FROM = "AptDesignerAI <hello@aptdesignerai.com>";

/**
 * Dry-run provider: the safe default. Never sends; records intent so the
 * lifecycle can be exercised end-to-end before a real provider is connected.
 */
export class DryRunProvider implements EmailProvider {
  readonly name = "dry-run";
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.info(
      `[email:dry-run] would send "${message.subject}" to ${message.to}` +
        (message.stage ? ` (stage: ${message.stage})` : ""),
    );
    return { delivered: false, dryRun: true, id: `dryrun:${message.stage ?? "none"}` };
  }
}

/**
 * Whether email sending is in dry-run mode. Single source of truth:
 * getEmailProvider() returns the live provider iff this is false, so callers can
 * rely on `!isEmailDryRun()` meaning "a real send will be attempted".
 * - GROWTH_EMAIL_DRY_RUN=1 forces dry-run even if a key is present.
 * - No RESEND_API_KEY ⇒ always dry-run (a live send is impossible without a key),
 *   even when GROWTH_EMAIL_DRY_RUN=0 tries to force live.
 * - Key present and not force-dry-run (flag "0" or unset) ⇒ live.
 */
export function isEmailDryRun(): boolean {
  if (process.env.GROWTH_EMAIL_DRY_RUN === "1") return true;
  if (!process.env.RESEND_API_KEY) return true;
  return false;
}

/** Resolve the active email provider based on the environment. */
export function getEmailProvider(): EmailProvider {
  if (isEmailDryRun()) return new DryRunProvider();
  // isEmailDryRun() === false guarantees RESEND_API_KEY is present.
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  return new ResendProvider(process.env.RESEND_API_KEY as string, from);
}

function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/**
 * Send a transactional/lifecycle email through the configured provider.
 * Validates input and never throws — always returns a result the caller can log.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  // Validation failures short-circuit before any provider runs, so dryRun is
  // false (no dry-run send happened — see EmailSendResult.dryRun).
  if (!isValidEmail(message.to)) {
    return { delivered: false, dryRun: false, error: "Invalid recipient address" };
  }
  if (message.replyTo && !isValidEmail(message.replyTo)) {
    return { delivered: false, dryRun: false, error: "Invalid reply-to address" };
  }
  if (!message.subject.trim()) {
    return { delivered: false, dryRun: false, error: "Missing subject" };
  }
  if (!message.html.trim()) {
    return { delivered: false, dryRun: false, error: "Missing body" };
  }
  return getEmailProvider().send(message);
}
