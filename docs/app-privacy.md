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
| Room photos (user-uploaded) | Photos or Videos | AI room analysis pipeline | Yes |
| Design preferences & history | Other User Content | Saved designs, design direction history | Yes |
| App interaction events | Usage Data | In-app navigation + feature usage (no third-party SDK today) | No |

**Not collected:** name, phone number, physical address, precise or coarse location,
health data, financial info, browsing history, search history, sensitive info,
contacts, user content beyond room photos, messages, third-party social IDs.

---

## Apple App Privacy (App Store Connect)

### Does the app collect data? → **Yes**

### Data Used to Track You
**None.** The app does not use any Advertising ID, third-party analytics SDK,
or cross-app tracking. Select **No** on the "Does this app use third-party
advertising networks, analytics tools, or SDKs to track users across apps and
websites owned by other companies?" question.

> ATT prompt: **Not required** (no tracking).

### Data Linked to You

**Contact Info**
- Email address — *App Functionality* (authentication, account management)

**Photos or Videos**
- Photos — *App Functionality* (submitted by user for AI room analysis; processed
  by Google Gemini API; stored in Supabase under the user's account)

**User Content**
- Other User Content (design history, preferences, saved rooms) — *App Functionality*

### Data Not Linked to You
**Usage Data**
- App usage data (screen views, feature interactions) — *Analytics* — collected
  only via server-side logs (no third-party SDK). Not linked to a persistent
  advertising identity.

### Third-party data sharing disclosures

| Recipient | Data shared | Purpose |
|---|---|---|
| Google (Gemini API) | Room photos, room type, user context text | AI analysis — third-party processing, covered by Google's data processing terms |
| Supabase | Email address, room photos, design data | Database + storage hosting |
| Tavily Search API | Product search query strings derived from AI design output (e.g. "mid-century oak bookshelf") — no PII | Product sourcing — web search for furniture and décor recommendations |
| Stripe | Name, email address, payment card data (collected directly by Stripe; we never see raw card data) | Payment processing for Apartment ($29) and Pro plans |
| Google (Maps/Places API) | Product image search queries — no PII | Product imagery — fetching photos of identified furniture products |
| Browserbase | Screenshots of product pages — no PII; no user data transmitted | Product verification — computer-vision agent confirms product images match descriptions |
| DeepSeek | Design analysis text, product descriptions — no PII | AI analysis (optional secondary provider for cost optimization) |

None of the above use this data to build ad profiles or track users across apps
per their published data processing agreements. Tavily and Google Maps queries
contain only design-derived product terms; no email, photo, or other personal
data is included. Stripe processes payments under its own PCI-DSS certification.
DeepSeek is used only for design text analysis, never for user-identifying data.

---

## Google Play Data Safety

### Does your app collect or share any of the required data types? → **Yes**

### Data collected

| Category | Type | Required? | Encrypted? | Deletion on request? |
|---|---|---|---|---|
| Personal info | Email address | Required to use app | Yes (TLS) | Yes — in-app account deletion |
| Photos & videos | Photos | Optional (user-initiates) | Yes (TLS) | Yes — deleted on account deletion |
| App activity | App interactions | Yes | Yes (TLS) | Yes |

### Is the data shared with third parties? → **Yes**

| Third party | Data | Purpose |
|---|---|---|
| Google (Gemini API) | Photos, analysis text | App functionality — AI analysis |
| Supabase | All user data | Infrastructure — data storage/hosting |
| Tavily Search API | Product search query strings (no PII) | App functionality — product sourcing search |
| Stripe | Email, payment data (Stripe-only; we do not store card numbers) | Financial info — payment processing |
| Google (Maps/Places API) | Product search terms (no PII) | App functionality — product imagery |
| Browserbase | Product page screenshots (no PII) | App functionality — product verification |
| DeepSeek | Design text (no PII) | App functionality — AI analysis (optional provider) |

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
