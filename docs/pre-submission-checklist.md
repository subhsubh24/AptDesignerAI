# Pre-Submission Checklist

Run this checklist manually before submitting to the App Store and Google Play. Every box must pass.

---

## 1. Core journey — no crashes

Walk the full path on a real device (iOS + Android) and in a desktop browser:

- [ ] **Sign up** — create a new account; no crash, no stuck spinner
- [ ] **Photo upload** (web) — upload a room photo; progress bar moves; room appears in dashboard
- [ ] **Photo capture** (mobile) — camera and gallery pickers work; photo previews correctly
- [ ] **Room-type picker** (mobile) — all 6 options selectable; navigates to results
- [ ] **AI analysis** (mobile) — uploading and analyzing stages complete; results screen shows style name, palette, what-to-keep/remove
- [ ] **Save design** (mobile) — Save Design button saves; saved designs screen shows the card
- [ ] **Diagnosis** (web) — room diagnosis runs to completion; no 500 error
- [ ] **Product sourcing** (web) — search results appear; scoring badges visible
- [ ] **Bundle comparison** (web) — bundles load and can be compared
- [ ] **Saved designs** (web) — `/saved` lists designs; detail page opens
- [ ] **Share link** (web) — share toggle generates a link; public `/shared/[token]` page renders

---

## 2. Required URLs — all resolve with HTTP 200

Check each route in a browser (or `curl -I`):

- [ ] `/privacy` — Privacy Policy page loads
- [ ] `/terms` — Terms of Service page loads
- [ ] `/support` — Support page loads (linked in store listing as support URL)
- [ ] `/waitlist` — Waitlist page loads (linked in store marketing)
- [ ] `/billing/upgrade` — Upgrade page loads without auth errors
- [ ] `/account` — Account Settings page loads (contains in-app account deletion)
- [ ] `/faq` — FAQ page loads
- [ ] `/guides` — Guides hub page loads

---

## 3. Permissions — sensible usage strings

Open `mobile/app.json` and verify:

- [ ] `photosPermission` accurately describes why photos are accessed
- [ ] `cameraPermission` accurately describes why the camera is used
- [ ] No placeholder text (`"TODO"`, `"Your app"`, `"Uses the camera"`)

Run `grep -r "TODO\|placeholder\|lorem ipsum" mobile/app.json` — should return nothing.

---

## 4. No debug or placeholder content

- [ ] `grep -r "console\.log\|TODO\|FIXME\|placeholder" app/ lib/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"` — review output; no user-facing debug strings
- [ ] No `example.com` URLs in any shipped page (check `evals/` separately — placeholder URLs there are OK pre-A5)
- [ ] RevenueCat public SDK key is set in EAS secrets (not hardcoded)
- [ ] Stripe live keys are in Vercel env vars (see PENDING_OPS.md)
- [ ] `EXPO_PUBLIC_API_URL` points to the live Vercel deployment, not localhost

---

## 5. Billing and entitlements

- [ ] Free user on mobile: Save Design is blocked after 3 saves (403 with `subscription_required: true`)
- [ ] Free user on web: POST `/api/saved-designs` returns 403 after 3 saves
- [ ] RevenueCat paywall shows on mobile after the 3rd save attempt
- [ ] `/billing/upgrade` loads and the checkout button initiates a Stripe session (Stripe test mode first, then live)
- [ ] Restore Purchases works on a previously-subscribed test account

---

## 6. Store assets — all generated and uploaded

- [ ] App icon (1024×1024 PNG, no rounded corners — stores add them) uploaded to App Store Connect and Play Console
- [ ] iOS screenshots: 6.9" (iPhone 16 Pro Max), 6.5" (iPhone 14 Plus), 5.5" (iPhone 8 Plus), iPad Pro 12.9" — minimum 3 screenshots per size
- [ ] Android screenshots: Phone (1080×1920 minimum) + 7-inch and 10-inch tablet if submitting tablet screenshots
- [ ] Short description ≤ 30 characters (Play Store subtitle)
- [ ] Full description ≤ 4000 characters (both stores)
- [ ] Keywords field filled (App Store only — 100 character limit)
- [ ] Privacy Policy URL set in App Store Connect + Play Console: `https://aptdesignerai.com/privacy`
- [ ] Support URL set: `https://aptdesignerai.com/support`
- [ ] Marketing URL set: `https://aptdesignerai.com`

---

## 7. Privacy and data declarations

- [ ] Apple App Privacy labels filled in App Store Connect (data types, linked/not-linked, tracking)
  - Reference: `docs/app-privacy.md`
- [ ] Google Play Data Safety form completed
  - Reference: `docs/app-privacy.md`
- [ ] ATT (App Tracking Transparency) prompt: confirm we are NOT calling `requestTrackingAuthorization` (we don't track cross-app identifiers — no ATT needed)

---

## 8. Migrations applied to production

- [ ] `supabase db push` run after each migration in `supabase/migrations/` not yet applied
  - Pending: `017_waitlist.sql`, `018_stripe_customers.sql` (see PENDING_OPS.md)
- [ ] `SELECT count(*) FROM waitlist_emails` returns 0 rows with no error (table exists)
- [ ] `SELECT count(*) FROM stripe_customers` returns 0 rows with no error (table exists)

---

## 9. EAS and build verification

- [ ] `eas build --platform all --profile production` completes without error
- [ ] iOS `.ipa` installs via TestFlight and runs on a real device without crashing
- [ ] Android `.aab` installs via internal testing track and runs on a real device without crashing
- [ ] App icon and splash screen appear correctly (warm-editorial palette — not the Expo default blue)
- [ ] App name in the OS home screen is "AptDesigner" (not "mobile" or "Expo Go")

---

## 10. Human Core final steps (owner-only)

Refer to the Human Core section in ROADMAP.md. These cannot be done by the loop:

1. Apple Developer account and Google Play account active
2. Signing certs / provisioning profiles generated in EAS
3. RevenueCat products and Entitlements configured in the RC dashboard
4. Stripe live keys set in Vercel; webhook registered
5. All PENDING_OPS.md items applied
6. Final submission in App Store Connect → "Submit for Review"
7. Final submission in Play Console → "Review and release"
