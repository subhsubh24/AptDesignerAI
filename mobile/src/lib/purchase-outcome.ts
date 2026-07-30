// What did a purchase attempt actually DO? — the side-effect-integrity layer
// between `Purchases.purchasePackage()` and unlocking Pro.
//
// The paywall used to treat "the promise settled" as the answer:
//
//     await Purchases.purchasePackage(pkg);
//     onPurchaseSuccess?.();          // resolved  -> unlock
//     ... catch  -> "Purchase failed. Please try again or restore …"
//
// Neither half of that is true, and both are wrong in a direction that costs
// money.
//
// RESOLVED IS NOT ENTITLED. `purchasePackage` resolves with a `customerInfo`,
// and whether the entitlement actually became ACTIVE is a property of THAT
// payload, not of the promise settling. RevenueCat's own guidance is explicit:
// do not grant entitlements for pending purchases — it tracks the pending state
// internally and updates CustomerInfo when payment is confirmed, so the app's job
// is to check the entitlement. Three reachable causes:
//   - Google Play's ASYNCHRONOUS payment methods (cash at a store, bank transfer,
//     carrier billing), which sit in PENDING until payment clears. Common in
//     markets with low card penetration, so this is a real case for any app sold
//     internationally, not an edge case. (NOT to be confused with Play "prepaid"
//     plans, which are a different RevenueCat concept and DO grant immediately.)
//   - iOS "Ask to Buy" (Family Sharing parental approval), pending until approved.
//   - A product not mapped to this entitlement in the RevenueCat dashboard — a
//     misconfiguration, and the one cause that never resolves on its own.
// Firing the unlock on any of them hands out Pro against a payment that has not
// happened — and if the app re-reads state a moment later, the user watches Pro
// appear and vanish. `handleRestore` in the same component always got this right
// (it checks `entitlements.active[ID]?.isActive`); the purchase path never asked.
//
// THROWN IS NOT FAILED. A pending payment can also arrive as a THROW with code
// PAYMENT_PENDING_ERROR ("20"). Reporting that as "Purchase failed — please try
// again" is the worst available answer: the charge is legitimately in flight, and
// we have just invited the buyer to start a second one. Cancellation is likewise
// not a failure, and the modern signal for it is the error CODE — `userCancelled`
// is deprecated in RevenueCat's own types and is `boolean | null`, so a null on
// a genuine cancel would surface a "Purchase failed" alert over the OS dialog
// the user just dismissed on purpose.
//
// Typed STRUCTURALLY rather than against RevenueCat's `CustomerInfo` /
// `PurchasesError`, and every field access guarded, for the two reasons
// `paywall-trial.ts` gives next door: it keeps this module native-import-free so
// the web test runner can exercise it (the Expo app has no runner of its own),
// and the network payload behind those types is not actually type-checked at
// runtime, so a missing field is a real possibility rather than a hypothetical.

/** RevenueCat PURCHASES_ERROR_CODE values, mirrored to keep this module native-free. */
export const ERROR_CODE_PURCHASE_CANCELLED = "1";
export const ERROR_CODE_PRODUCT_ALREADY_PURCHASED = "6";
export const ERROR_CODE_PAYMENT_PENDING = "20";

/** The shape of the `customerInfo` this module reads, and nothing more. */
export interface EntitlementProbeInfo {
  readonly entitlements?: {
    readonly active?: Record<string, { readonly isActive?: unknown } | null | undefined> | null;
  } | null;
}

/**
 * Did `entitlementId` come back genuinely ACTIVE?
 *
 * Strict `=== true` rather than truthiness: the payload is untyped at runtime,
 * and a string `"false"` or a stray `1` must not read as an unlock. Every
 * uncertain shape — no customerInfo, no entitlements map, entitlement absent,
 * `isActive` missing — answers false, because granting access we cannot confirm
 * is the harmful direction and withholding it merely costs a support message.
 */
export function hasActiveEntitlement(
  info: EntitlementProbeInfo | null | undefined,
  entitlementId: string,
): boolean {
  const active = info?.entitlements?.active;
  if (!active || typeof active !== "object") return false;
  return active[entitlementId]?.isActive === true;
}

/**
 * What a resolved `purchasePackage` MEANS.
 *
 *   "unlocked" — the entitlement is active. This is the only outcome that may
 *                fire the unlock.
 *   "pending"  — the store accepted the transaction but granted no entitlement.
 *                Do not unlock, and do not call it a failure either: it is a real
 *                purchase awaiting payment (a Play asynchronous payment method,
 *                iOS Ask to Buy) or a product not mapped to this entitlement in
 *                RevenueCat. Both need the same user-facing answer — "we'll
 *                unlock it as soon as the store confirms" — and neither should
 *                invite a retry that could double-charge.
 */
export function classifyPurchaseResult(
  result: { readonly customerInfo?: EntitlementProbeInfo | null } | null | undefined,
  entitlementId: string,
): "unlocked" | "pending" {
  return hasActiveEntitlement(result?.customerInfo, entitlementId) ? "unlocked" : "pending";
}

/**
 * What a THROWN purchase error means.
 *
 *   "cancelled"     — the user dismissed the OS dialog. Say nothing; they meant it.
 *   "pending"       — payment is in flight (PAYMENT_PENDING_ERROR). Never offer a
 *                     retry here.
 *   "already-owned" — the store already holds this purchase for this account
 *                     (PRODUCT_ALREADY_PURCHASED_ERROR). This is the SECOND-TAP
 *                     case: after a pending purchase the CTA re-enables, so a user
 *                     who taps Subscribe again lands here. Without its own branch
 *                     it falls into "failed", whose copy says "please try again" —
 *                     the exact advice the pending branch exists to stop giving,
 *                     reached one tap later. The answer is Restore, not retry.
 *   "failed"        — a genuine error worth surfacing.
 *
 * Reads the error CODE first, since `userCancelled` is deprecated and nullable,
 * but still honours a `userCancelled === true` from an older payload that
 * carries no recognisable code.
 */
export function classifyPurchaseError(
  err: unknown,
): "cancelled" | "pending" | "already-owned" | "failed" {
  if (typeof err !== "object" || err === null) return "failed";
  const e = err as Record<string, unknown>;

  // Codes are STRINGS in the RN SDK's enum ("1", "6", "20"). Compare as strings,
  // but tolerate a numeric code from a bridge that did not stringify it.
  const code = typeof e.code === "number" ? String(e.code) : e.code;
  if (code === ERROR_CODE_PURCHASE_CANCELLED) return "cancelled";
  if (code === ERROR_CODE_PAYMENT_PENDING) return "pending";
  if (code === ERROR_CODE_PRODUCT_ALREADY_PURCHASED) return "already-owned";

  if (e.userCancelled === true) return "cancelled";
  return "failed";
}
