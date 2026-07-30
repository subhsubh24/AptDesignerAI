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
// payload, not of the promise settling. Google Play prepaid and deferred
// ("pending") transactions are the documented case: the store accepts the
// transaction and grants the entitlement only once payment completes, so
// customerInfo comes back with the entitlement inactive. iOS "Ask to Buy"
// (Family Sharing parental approval) behaves the same way. Firing the unlock
// there hands out Pro against a payment that has not happened — and if the app
// instead re-reads state a moment later, the user watches Pro appear and vanish.
// `handleRestore` in the same component always got this right (it checks
// `entitlements.active[ID]?.isActive`); the purchase path simply did not ask.
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
 *                Do not unlock, and do not call it a failure either: it is a
 *                real purchase awaiting payment (Play prepaid/deferred, iOS Ask
 *                to Buy) or a product not mapped to this entitlement in
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
 *   "cancelled" — the user dismissed the OS dialog. Say nothing; they meant it.
 *   "pending"   — payment is in flight (PAYMENT_PENDING_ERROR). Never offer a
 *                 retry here.
 *   "failed"    — a genuine error worth surfacing.
 *
 * Reads the error CODE first, since `userCancelled` is deprecated and nullable,
 * but still honours a `userCancelled === true` from an older payload that
 * carries no recognisable code.
 */
export function classifyPurchaseError(err: unknown): "cancelled" | "pending" | "failed" {
  if (typeof err !== "object" || err === null) return "failed";
  const e = err as Record<string, unknown>;

  // Codes are STRINGS in the RN SDK's enum ("1", "20"). Compare as strings, but
  // tolerate a numeric code from a bridge that did not stringify it.
  const code = typeof e.code === "number" ? String(e.code) : e.code;
  if (code === ERROR_CODE_PURCHASE_CANCELLED) return "cancelled";
  if (code === ERROR_CODE_PAYMENT_PENDING) return "pending";

  if (e.userCancelled === true) return "cancelled";
  return "failed";
}
