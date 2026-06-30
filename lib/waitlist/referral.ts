/**
 * Waitlist referral helpers.
 *
 * Each confirmed (and pending) waitlist subscriber gets a short, unguessable
 * referral code they can share; people who arrive via `?ref=<code>` are
 * attributed back to the referrer. This is the pre-launch growth loop that
 * turns the waitlist into a self-spreading channel (it's also the concrete
 * "invite/reward mechanic" the business case lists as a revenue lever — the
 * organic-share input is only defensible once a real referral path exists).
 *
 * Pure functions only — no DB / network — so they're trivially testable and
 * safe to call from the edge-adjacent API route.
 */

import { randomBytes } from "node:crypto";

// Crockford-style alphabet minus ambiguous glyphs (no I/L/O/0/1) so codes are
// readable aloud and hard to mistype when shared.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** Generate a random, unguessable referral code (8 chars, ~6.5e11 space). */
export function generateReferralCode(length: number = CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Normalise and validate an inbound `?ref=` value before it touches the DB.
 * Returns the upper-cased code, or null if it's missing/malformed — so junk,
 * oversized, or injection-shaped input is never stored as an attribution.
 */
export function sanitizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(trimmed)) return null;
  return trimmed;
}

/** Build the absolute share URL a subscriber sends to friends. */
export function buildReferralShareUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/waitlist?ref=${encodeURIComponent(code)}`;
}
