// Social publishing entry point — one abstraction the growth engine publishes
// through (E7.3). Mirrors lib/email.
//
// Default behaviour is DRY-RUN per platform: until the owner supplies that
// channel's credentials (see docs/growth/CONNECT.md), every publish is logged
// and acknowledged but nothing leaves the system. This keeps the staged social
// content safe to queue and flush end-to-end before any channel is connected.
// Live API integration per provider is added when a channel is connected; this
// release ships the queue + the safe dry-run path.

import {
  PLATFORM_MAX_BODY,
  type SocialPlatform,
  type SocialPost,
  type SocialProvider,
  type SocialPublishResult,
} from "./types";

export {
  SOCIAL_PLATFORMS,
  PLATFORM_MAX_BODY,
  isSocialPlatform,
} from "./types";
export type {
  SocialPlatform,
  SocialPost,
  SocialProvider,
  SocialPublishResult,
} from "./types";

// Env var (per platform) the owner sets to connect a channel. Presence of the
// primary credential flips that platform out of dry-run. Documented in
// docs/growth/CONNECT.md. Keep in sync with that runbook (LIVING ARTIFACTS).
const PLATFORM_CREDENTIAL_ENV: Record<SocialPlatform, string> = {
  x: "X_API_KEY",
  instagram: "INSTAGRAM_ACCESS_TOKEN",
  tiktok: "TIKTOK_ACCESS_TOKEN",
  reddit: "REDDIT_CLIENT_ID",
};

/**
 * Whether publishing for a platform is in dry-run mode. Single source of truth.
 * - GROWTH_SOCIAL_DRY_RUN=1 forces dry-run for ALL platforms even if creds exist.
 * - No primary credential for the platform ⇒ always dry-run (a live send is
 *   impossible), even when the force flag tries to go live.
 * - Credential present and not force-dry-run ⇒ live.
 */
export function isSocialDryRun(platform: SocialPlatform): boolean {
  if (process.env.GROWTH_SOCIAL_DRY_RUN === "1") return true;
  if (!process.env[PLATFORM_CREDENTIAL_ENV[platform]]) return true;
  return false;
}

/**
 * Dry-run provider: the safe default. Never sends; records intent so the queue
 * can be flushed end-to-end before a real channel is connected.
 */
export class DryRunSocialProvider implements SocialProvider {
  readonly name = "dry-run";
  constructor(private readonly platform: SocialPlatform) {}
  async publish(post: SocialPost): Promise<SocialPublishResult> {
    const preview = post.body.length > 60 ? `${post.body.slice(0, 57)}…` : post.body;
    console.info(`[social:dry-run] would post to ${this.platform}: "${preview}"`);
    return { published: false, dryRun: true, id: `dryrun:${this.platform}` };
  }
}

/**
 * Resolve the active provider for a platform. Currently every platform resolves
 * to the dry-run provider until its live API client is wired (the credential
 * gate above already keeps unconnected channels in dry-run); when a provider is
 * implemented, swap it in here behind the same isSocialDryRun() check.
 */
export function getSocialProvider(platform: SocialPlatform): SocialProvider {
  // Live provider clients are added per channel as they're connected. Until
  // then the dry-run provider is always returned, so a flush is a safe no-op.
  return new DryRunSocialProvider(platform);
}

function validate(post: SocialPost): string | null {
  const body = post.body?.trim();
  if (!body) return "Empty post body";
  const max = PLATFORM_MAX_BODY[post.platform];
  // Validate the trimmed length (what publishPost actually sends), not the raw
  // input — otherwise whitespace padding is wrongly counted against the cap.
  if (body.length > max) return `Body exceeds ${max} characters for ${post.platform}`;
  if (post.mediaUrls && post.mediaUrls.some((u) => typeof u !== "string" || !u.trim())) {
    return "Invalid media URL";
  }
  return null;
}

/**
 * Publish a single post through the platform's provider. Validates first and
 * never throws — always returns a result the queue can record.
 */
export async function publishPost(post: SocialPost): Promise<SocialPublishResult> {
  const invalid = validate(post);
  if (invalid) return { published: false, dryRun: false, error: invalid };
  return getSocialProvider(post.platform).publish(post);
}
