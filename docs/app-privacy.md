# App Privacy Labels — AptDesignerAI

Staged content for **Apple App Privacy** (App Store Connect → App Information →
App Privacy) and **Google Play Data Safety** form. Owner fills these forms in the
respective developer portals; this doc is the source of truth so both platforms
stay consistent.

---

## What data we collect

| Data type | Category | Why collected | Linked to identity? |
|---|---|---|---|
| Email address | Contact Info | Account creation + authentication | Yes |
| Name | Contact Info | Optional free-text field at signup, stored on the profile and shown back in the app's top bar | Yes |
| Room photos (user-uploaded) | Photos or Videos | AI room analysis pipeline | Yes |
| Design preferences & history | Other User Content | Saved designs, design direction history | Yes |
| Floor plans (user-uploaded) | Photos or Videos / Other User Content | Uploaded image or PDF of the unit's floor plan, plus the layout extracted from it (`projects.building_research`) | Yes |
| Free-text notes about a room | Other User Content | What the user types about how they use the room (`rooms.user_context`), fed to the AI as design context | Yes |
| Refine-chat messages | Other User Content | The back-and-forth when a user asks for design changes (`refine_messages`, migration 012) | Yes |
| Apartment building, neighborhood, city/state | Contact Info → Physical Address | The user types their building into an address autocomplete during project setup, so the AI can research the building's real layout, finishes and light | Yes |
| Coordinates of the selected building | Location → Precise Location | Stored with the project (`projects.latitude` / `.longitude`) and passed to Gemini's Maps grounding for building orientation, view and neighbourhood context | Yes |
| App interaction events | Usage Data | In-app navigation + feature usage (via Vercel Web Analytics — cookieless, no ad identifiers) | No |

**About the location entry — read before filling either form.** This is *not*
device location. The app never requests a location permission on any platform
(see the device-permission list below — location is not among them), never
reads GPS, and never tracks the user's movement. What is
collected is a single address the user deliberately types and picks from an
autocomplete, plus the coordinates Google Places returns for that address.
Because the stored value is a latitude/longitude at full precision, Apple's
definition puts it under **Precise Location** regardless of how it was obtained,
so it is declared here rather than argued down to Coarse.

**Not collected:** phone number, health data, financial info (card data goes
straight to Stripe and never reaches our servers), browsing history, search
history, sensitive info, contacts, third-party social IDs, device/GPS location,
background location, and any content the user did not deliberately submit to the
design pipeline.

## Device permissions the app requests

Derived from the Expo plugin list in `mobile/app.json`. Both store forms ask
about permissions separately from data collection, and a permission the app
requests but the form omits is an incomplete attestation — so this list is the
one to check against `mobile/app.json` before filling either form, and
`__tests__/compliance/privacy-disclosure.test.ts` fails if a permission-
requesting plugin is added without being declared here and on `/privacy`.

| Permission | Plugin | Why | Data it produces |
|---|---|---|---|
| Camera | `expo-image-picker` (`cameraPermission`) | Photograph the room for design analysis | The photo — already declared above under Photos or Videos |
| Photo library | `expo-image-picker` (`photosPermission`) | Pick an existing room photo. Only the selected image is read | The photo — as above |
| Notifications | `expo-notifications` | Tell the user when a design they asked for is ready, plus occasional product updates. Declining leaves the app fully functional | An Expo push token (see below) |

**The push token, stated precisely.** `mobile/src/hooks/use-push-notifications.ts`
requests the notification permission and, if granted, obtains an Expo push token
and writes it to on-device `AsyncStorage`. As of today nothing sends it
anywhere: there is no server endpoint that receives it (the server-side sender
is still an open item in `PENDING_OPS.md`). Under Apple's definition, data is
"collected" when it is transmitted off the device, so the token is **not**
declared as Device ID on either form today, and that is why no identifier row
appears in the tables below.

**This is the one entry most likely to go stale.** The moment the server-side
sender lands, the token starts leaving the device and both forms must gain an
identifier declaration (Apple: Identifiers → Device ID, linked to the user;
Play: Device or other IDs) before the next submission.

---

## Apple App Privacy (App Store Connect)

### Does the app collect data? → **Yes**

### Data Used to Track You
**None.** The app uses no Advertising ID and does no cross-app tracking. It does
use Vercel Web Analytics, but it is cookieless and collects only aggregate usage
events with no advertising identifiers, so it does not "track" users in Apple's
sense (it never links data with third-party data for ads or shares it with data
brokers). Select **No** on the "Does this app use third-party advertising
networks, analytics tools, or SDKs to track users across apps and websites owned
by other companies?" question.

> ATT prompt: **Not required** (no tracking).

### Data Linked to You

**Contact Info**
- Email address — *App Functionality* (authentication, account management)
- Name — *App Functionality* (optional at signup; stored on the user's profile
  and displayed back to them in the app)
- Physical Address — *App Functionality* (the apartment building / neighbourhood /
  city the user selects at project setup, used to research that specific building)

**Location**
- Precise Location — *App Functionality* (latitude/longitude of the
  user-selected building, from Google Places; used for building orientation,
  light and neighbourhood context). **No device location is used** — the app
  requests no location permission and reads no GPS.

**Photos or Videos**
- Photos — *App Functionality* (submitted by user for AI room analysis; processed
  by Google Gemini API; stored in Supabase under the user's account)

**User Content**
- Other User Content (design history, preferences, saved rooms; floor plans and
  the layout extracted from them; free-text room notes; refine-chat messages) —
  *App Functionality*

### Data Not Linked to You
**Usage Data**
- App usage data (screen views, feature interactions) — *Analytics* — collected
  via Vercel Web Analytics (cookieless, no cross-app advertising identifiers) and
  server-side logs. Not linked to a persistent advertising identity.

### Third-party data sharing disclosures

| Recipient | Data shared | Purpose |
|---|---|---|
| Google (Gemini API) | Room photos, room type, user context text | AI analysis — third-party processing, covered by Google's data processing terms |
| Supabase | Email address, room photos, design data | Database + storage hosting |
| Tavily Search API | Product search query strings derived from AI design output (e.g. "mid-century oak bookshelf") — no PII | Product sourcing — web search for furniture and décor recommendations |
| Stripe | Name, email address, payment card data (collected directly by Stripe; we never see raw card data) | Payment processing for Apartment ($29) and Pro plans |
| RevenueCat | Account/user ID + subscription/purchase status | Cross-platform in-app subscription + entitlement management (mobile). Inert until REVENUECAT keys are set. |
| Google (Maps/Places API) | What the user types into the address box plus the selected building's place_id; Google's Places JS library is loaded on every page of the web app, so Google also sees each visitor's IP address and referring page | Address / building autocomplete at project setup, and fetching a photo of the selected building by place_id |
| Browserbase | Screenshots of product pages — no PII; no user data transmitted | Product verification — computer-vision agent confirms product images match descriptions |
| Resend | Email address | Transactional + account email delivery (waitlist confirmation, sign-in, billing notices). Runs in dry-run mode until RESEND_API_KEY is set. |
| Cloudflare (Turnstile) | Bot-challenge token + IP address on the signup/waitlist forms — no account content | Bot / abuse protection on public forms. Inert until TURNSTILE_SECRET_KEY is set. |
| DeepSeek | Design analysis text, product descriptions — no PII | AI analysis (optional secondary provider for cost optimization) |
| Vercel (Web Analytics) | Aggregate app-usage events (screen views, feature interactions) — no PII; cookieless | Analytics — measure usage and funnel; no cross-app ad identifiers |
| Margin | AI-usage telemetry only: token counts, latency, model name, per-request outcome quality score — no PII, photos, account identifiers, or prompt content | Cost-per-outcome economics. Inert until MARGIN_INGEST_KEY is set; never egresses in CI/E2E. |

None of the above use this data to build ad profiles or track users across apps
per their published data processing agreements. Tavily queries contain only
design-derived product terms, with no email, photo, or other personal data.
Google Maps/Places is the one exception to "no personal data in queries": the
address the user types is personal data by definition, and Google's script runs
on every page of the web app. Stripe processes payments under its own PCI-DSS
certification.
DeepSeek is used only for design text analysis, never for user-identifying data.
Vercel Web Analytics is cookieless and collects only aggregate usage events with
no advertising identifiers.

---

## Google Play Data Safety

### Does your app collect or share any of the required data types? → **Yes**

### Data collected

| Category | Type | Required? | Encrypted? | Deletion on request? |
|---|---|---|---|---|
| Personal info | Email address | Required to use app | Yes (TLS) | Yes — in-app account deletion |
| Personal info | Name (optional, entered at signup) | Optional (user-initiates) | Yes (TLS) | Yes — in-app account deletion |
| Personal info | Address (apartment building / neighbourhood / city, user-entered) | Optional (user-initiates) | Yes (TLS) | Yes — deleted on account deletion |
| Location | Approximate & precise location (coordinates of the user-selected building; **not** device location — no location permission is requested) | Optional (user-initiates) | Yes (TLS) | Yes — deleted on account deletion |
| Photos & videos | Photos, floor-plan images/PDFs | Optional (user-initiates) | Yes (TLS) | Yes — deleted on account deletion |
| Messages | In-app refine-chat messages between the user and the design agent | Optional (user-initiates) | Yes (TLS) | Yes — deleted on account deletion |
| App activity | App interactions | Yes | Yes (TLS) | Yes |

### Is the data shared with third parties? → **Yes**

| Third party | Data | Purpose |
|---|---|---|
| Google (Gemini API) | Photos, analysis text | App functionality — AI analysis |
| Supabase | All user data | Infrastructure — data storage/hosting |
| Tavily Search API | Product search query strings (no PII) | App functionality — product sourcing search |
| Stripe | Email, payment data (Stripe-only; we do not store card numbers) | Financial info — payment processing |
| RevenueCat | Account/user ID + subscription status | App functionality — mobile subscription/entitlement management |
| Google (Maps/Places API) | User-typed address text, selected building's place_id, and (via the Places script loaded on every web page) visitor IP + referring page | App functionality — address/building autocomplete and building photo lookup |
| Browserbase | Product page screenshots (no PII) | App functionality — product verification |
| Resend | Email address | App functionality — transactional/account email (dry-run until RESEND_API_KEY set) |
| Cloudflare (Turnstile) | Bot-challenge token + IP (signup/waitlist forms; no account content) | App functionality — bot/abuse protection (inert until TURNSTILE_SECRET_KEY set) |
| DeepSeek | Design text (no PII) | App functionality — AI analysis (optional provider) |
| Vercel (Web Analytics) | Aggregate usage events (no PII; cookieless) | Analytics — usage measurement |
| Margin | AI-usage telemetry (token counts, latency, model, outcome quality) — no PII | Analytics — cost-per-outcome economics (inert until MARGIN_INGEST_KEY set) |

### Security practices

- All data encrypted in transit (TLS/HTTPS)
- User can request data deletion via in-app account deletion flow (Settings →
  Account → Delete account) — satisfies Google Play's account deletion policy
- Users can also request deletion via support email (record in app listing)

---

## Support URL and privacy policy links

- Privacy policy: `https://aptdesignerai.com/privacy`
- Terms of service: `https://aptdesignerai.com/terms`
- Support contact: (owner sets this — use a real monitored email)

Both pages are live on the web app (built in earlier runs). Confirm the domain is
correct before submission; the links must be publicly reachable at review time.

---

## Data retention

- **Account data** (email, profile): retained until account deletion
- **Room photos**: retained in Supabase Storage until account deletion or user
  manually deletes them
- **Design history**: retained until account deletion
- **Server logs**: 30-day rolling retention (no user-identifying info beyond IP;
  IP logs not retained beyond 7 days per default Vercel policy)

---

## Action items for owner at submission time

- [ ] Fill Apple App Privacy form in App Store Connect using this document
- [ ] Fill Google Play Data Safety form using this document
- [ ] Confirm `https://aptdesignerai.com/privacy` and `/terms` are reachable
- [ ] Set a monitored support email in both store listings
- [ ] Review Google Gemini API data-processing agreement to confirm no ad usage
- [ ] Review Tavily data-processing terms to confirm no user profiling
- [ ] **Submit store listing copy only after RevenueCat paywall (Track C) is live** — store reviewers will test that paid features are actually gated. The subscription/pricing copy in store-listing.md is accurate for the intended final state.
