// Social publishing abstraction — shared types (E7.3).
//
// Mirrors the lib/email shape: a small Provider interface, a DryRunProvider
// default, and a single publish() entry point. The queue (lib/social/queue.ts)
// persists drafts; the providers here do the actual sending once the owner
// connects channel credentials. Until then every send is dry-run.

/** Channels the queue can target. Keep in sync with the CHECK in migration 023. */
export const SOCIAL_PLATFORMS = ["x", "instagram", "tiktok", "reddit"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** Per-platform body length ceilings (server-side guard; UX-side limits differ). */
export const PLATFORM_MAX_BODY: Record<SocialPlatform, number> = {
  x: 280,
  instagram: 2200,
  tiktok: 2200,
  reddit: 40000,
};

export interface SocialPost {
  platform: SocialPlatform;
  /** The post text. Non-empty, within PLATFORM_MAX_BODY[platform]. */
  body: string;
  /** Optional media/link URLs to attach. */
  mediaUrls?: string[];
}

export interface SocialPublishResult {
  /** True only when a live provider actually accepted the post. */
  published: boolean;
  /**
   * True when the dry-run provider handled it (no channel connected). False for
   * a live send AND for validation failures, where no provider ran at all.
   */
  dryRun: boolean;
  /** Provider post id, when available. */
  id?: string;
  /** Error summary when publishing failed (never the raw provider payload). */
  error?: string;
}

export interface SocialProvider {
  /** Stable provider name, e.g. "x" or "dry-run". */
  readonly name: string;
  publish(post: SocialPost): Promise<SocialPublishResult>;
}
