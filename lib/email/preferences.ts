/**
 * Marketing-email suppression check (CAN-SPAM).
 *
 * Reads user_email_preferences (migration 027) via the service-role admin
 * client. Used by the MARKETING send paths (activation cron, win-back webhook)
 * to skip users who opted out. Transactional mail (waitlist confirm, password
 * reset, purchase receipt) must NOT call this — only marketing sends consult it.
 *
 * Fail-CLOSED: if we can't determine the preference (no admin client, query
 * error), we SUPPRESS the marketing send rather than risk emailing someone who
 * may have opted out. Marketing mail is non-critical, so erring toward not
 * sending is the compliant choice; a missing row means "subscribed" (default).
 */

import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Returns true when a marketing email to this user should be SUPPRESSED.
 * Pass an existing admin client to avoid creating a second one.
 */
export async function isMarketingOptedOut(
  userId: string,
  adminClient?: ReturnType<typeof getAdminClient>,
): Promise<boolean> {
  const admin = adminClient ?? getAdminClient();
  if (!admin) {
    console.warn(
      "[email/preferences] no admin client — suppressing marketing send (fail-closed). " +
      "Set SUPABASE_SERVICE_ROLE_KEY (see PENDING_OPS.md).",
    );
    return true;
  }

  const { data, error } = await admin
    .from("user_email_preferences")
    .select("marketing_emails")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[email/preferences] preference lookup failed — suppressing marketing send:", error.message);
    return true; // fail-closed
  }

  // No row → subscribed by default. A row with marketing_emails=false → suppress.
  if (!data) return false;
  return data.marketing_emails === false;
}

/**
 * Batched variant of isMarketingOptedOut — one query for a whole cohort instead
 * of one per user. Built for the cron routes (activation/winback/habit emails),
 * which otherwise issue N sequential preference lookups per run. Same
 * fail-CLOSED semantics as the single-user function; keep that one for callers
 * that only ever check a single user.
 */
export async function getMarketingOptOutMap(
  userIds: string[],
  adminClient?: ReturnType<typeof getAdminClient>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!userIds.length) return result;

  const admin = adminClient ?? getAdminClient();
  if (!admin) {
    console.warn(
      "[email/preferences] no admin client — suppressing marketing send (fail-closed). " +
      "Set SUPABASE_SERVICE_ROLE_KEY (see PENDING_OPS.md).",
    );
    for (const userId of userIds) result.set(userId, true);
    return result;
  }

  const { data, error } = await admin
    .from("user_email_preferences")
    .select("user_id, marketing_emails")
    .in("user_id", userIds);

  if (error) {
    console.error(
      "[email/preferences] batched preference lookup failed — suppressing marketing send:",
      error.message,
    );
    for (const userId of userIds) result.set(userId, true); // fail-closed
    return result;
  }

  const rowByUser = new Map<string, boolean | null>();
  for (const row of data ?? []) {
    rowByUser.set(row.user_id, row.marketing_emails);
  }

  // No row → subscribed by default. A row with marketing_emails=false → suppress.
  for (const userId of userIds) {
    const marketingEmails = rowByUser.get(userId);
    result.set(userId, rowByUser.has(userId) ? marketingEmails === false : false);
  }
  return result;
}
