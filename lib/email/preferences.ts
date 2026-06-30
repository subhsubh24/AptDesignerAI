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
