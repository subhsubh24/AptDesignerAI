// Email provider abstraction — shared types.
//
// This is the transport layer the E4/E6 email lifecycle plugs into. The actual
// copy lives in docs/email-welcome-sequence.md (waitlist) and
// docs/email-lifecycle.md (signed-up users); `EmailStage` mirrors the stage
// identifiers used in those docs so a stage name in code maps 1:1 to its copy.
// Keep this union in sync if a sequence is added/renamed (LIVING ARTIFACTS).

/**
 * Lifecycle stage an email belongs to. Used for logging / analytics so we can
 * see which sequence fired without parsing subject lines.
 *
 * Doc mapping:
 *   waitlist_confirm                         -> double opt-in confirmation (E7.1; precedes the welcome sequence)
 *   waitlist_welcome_1..3 / waitlist_launch  -> docs/email-welcome-sequence.md (Emails 1–4)
 *   activation_1..3        -> docs/email-lifecycle.md Sequence 1 (A1–A3)
 *   habit_1..3             -> docs/email-lifecycle.md Sequence 2 (B1–B3)
 *   upgrade_1..3           -> docs/email-lifecycle.md Sequence 3 (C1–C3)
 *   paid_engagement_1..2   -> docs/email-lifecycle.md Sequence 4 (D1–D2)
 *   winback_1..3           -> docs/email-lifecycle.md Sequence 5 (E1–E3)
 *   referral_share_1       -> docs/email-lifecycle.md Sequence 6 (F1)
 */
export type EmailStage =
  | "waitlist_confirm"
  | "waitlist_welcome_1"
  | "waitlist_welcome_2"
  | "waitlist_welcome_3"
  | "waitlist_launch"
  | "activation_1"
  | "activation_2"
  | "activation_3"
  | "habit_1"
  | "habit_2"
  | "habit_3"
  | "upgrade_1"
  | "upgrade_2"
  | "upgrade_3"
  | "paid_engagement_1"
  | "paid_engagement_2"
  | "winback_1"
  | "winback_2"
  | "winback_3"
  | "referral_share_1";

export interface EmailMessage {
  /** Recipient address. Validated before send. */
  to: string;
  /** Subject line. Must be non-empty. */
  subject: string;
  /** HTML body. Must be non-empty. */
  html: string;
  /** Optional plain-text alternative. */
  text?: string;
  /** Lifecycle stage, for logging/analytics. */
  stage?: EmailStage;
  /** Optional Reply-To override. */
  replyTo?: string;
}

export interface EmailSendResult {
  /** True only when a live provider actually accepted the message. */
  delivered: boolean;
  /**
   * True when the dry-run provider handled the send (no provider configured /
   * staged mode). False for a live send AND for validation failures, where no
   * provider ran at all.
   */
  dryRun: boolean;
  /** Provider message id, when available. */
  id?: string;
  /** Error summary when the send failed (never the raw provider payload). */
  error?: string;
}

export interface EmailProvider {
  /** Stable provider name, e.g. "resend" or "dry-run". */
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
