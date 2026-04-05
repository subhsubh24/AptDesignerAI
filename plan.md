# Plan: Google Maps Integration for Location & Building Search

## Problem
The current onboarding location step (Step 3) uses plain text inputs for city, state, and neighborhood. The building step (Step 4) also uses plain text for building name. This means:
- Users can typo city/neighborhood names, degrading downstream AI research
- No autocomplete or discovery — users must already know their neighborhood name
- Building name input has no validation or suggestions
- The app misses an opportunity to auto-fill city/state/neighborhood from a single search

## Two Complementary Approaches

### Approach A: Google Places Autocomplete (Address Dropdown)
**What:** Replace the 3 separate text inputs (city, state, neighborhood) with a single Google Places autocomplete search bar — the familiar "start typing an address" dropdown.

**How it works:**
- Use the new `PlaceAutocompleteElement` (the old `Autocomplete` class was deprecated for new customers as of March 2025)
- User types their address or neighborhood → dropdown shows predictions
- On selection, auto-extract `city`, `state`, `neighborhood` from the structured place data via `place.fetchFields()`
- Also works for the **building name** field — user types "Porte Apartments Chicago" and gets the real place with address, website, etc.

**Key implementation details:**
- **API:** Google Maps JavaScript API with Places library (new)
- **Component:** `PlaceAutocompleteElement` is a native HTML custom element (`<gmp-place-autocomplete>`)
- **React integration:** Wrap in a `useRef` + `useEffect` pattern or use `@vis.gl/react-google-maps` library
- **Types filter:** Constrain to `(regions)` for location step, `(establishment)` for building step
- **Fields to fetch:** `addressComponents`, `displayName`, `formattedAddress`, `location`, `websiteUri`
- **Cost:** Places Autocomplete: $2.83/1000 sessions (session-based pricing, very cheap)

**Files to change:**
1. `app/dashboard/page.tsx` — Replace city/state/neighborhood inputs with single autocomplete, replace building name input with establishment autocomplete
2. New component: `components/ui/place-autocomplete.tsx` — Reusable wrapper around `PlaceAutocompleteElement`
3. `app/layout.tsx` or `app/dashboard/layout.tsx` — Load Google Maps JS API script
4. `.env.local` — Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

**UX flow (location step):**
```
Current:  [City: ___] [State: ___] [Neighborhood: ___]  (3 fields)
Proposed: [🔍 Search your city or neighborhood...]       (1 field)
          ├─ West Loop, Chicago, IL
          ├─ Wicker Park, Chicago, IL
          └─ Lincoln Park, Chicago, IL
          
          Auto-fills: city="Chicago", state="IL", neighborhood="West Loop"
          User can still manually edit if needed
```

**UX flow (building step):**
```
Current:  [Building name: ___] [Website: ___]
Proposed: [🔍 Search your building...]
          ├─ Porte Apartments - 840 W Blackhawk St, Chicago
          ├─ AMLI River North - 747 N Clark St, Chicago  
          └─ The Parker Fulton Market - 939 W Randolph St
          
          Auto-fills: buildingName, buildingUrl (from websiteUri), 
          plus lat/lng for future use
```

---

### Approach B: Gemini Maps Grounding (AI-Powered Research)
**What:** Enhance the existing apartment research API call by enabling Gemini's Maps grounding tool, so the AI can pull real Google Maps data (place details, reviews, nearby amenities, neighborhood info) when researching the building.

**How it works:**
- When calling the Gemini API in `/api/apartment-research`, add `google_maps` as a tool alongside `google_search` and `url_context`
- Gemini will automatically use Maps data when the query involves location context
- Returns richer `neighborhood_vibe`, verified `amenities`, accurate `website_url`, and place photos
- Response includes `groundingMetadata` with `placeId` links back to Google Maps

**Key implementation details:**
- **API:** Already using `@google/genai` — just add `{ googleMaps: {} }` to the tools config
- **Model requirement:** Gemini 2.5+ (or Gemini 3 family) supports Maps grounding
- **Pricing:** Maps grounding requests are billed per Gemini API call + Maps data usage
- **Bonus:** Can combine with Google Search grounding in the same request (already doing search)

**Files to change:**
1. `app/api/apartment-research/route.ts` — Add `googleMaps` tool to Gemini config
2. Optionally store `placeId` in the `building_research` JSONB column for future use

---

### Approach C: Curated Popular Buildings List (Hybrid)
**What:** For the 4 target cities (Chicago, LA, NYC, SF), maintain a curated list of popular apartment buildings that appears as quick-select options.

**How it works:**
- After user selects city via Places Autocomplete, show a "Popular buildings nearby" section
- Could be a static JSON file initially, or populated from a Supabase table
- Clicking a building auto-fills name + URL + skips the research step if we already have cached data
- Falls back to free-text search for buildings not in the list

**Implementation:**
- New file: `lib/data/popular-buildings.ts` — Static data for known buildings per city
- New Supabase table (optional): `popular_buildings` with pre-cached research results
- UI: Show as clickable chips/cards below the building input when city matches

---

## Recommended Implementation Order

### Phase 1: Places Autocomplete for Location (Highest impact, simplest)
1. Set up Google Maps API key and script loading
2. Build `<PlaceAutocomplete>` reusable component  
3. Replace location step with single autocomplete field
4. Parse place result → auto-fill city/state/neighborhood
5. Keep manual override capability (editable fields below, collapsed by default)

### Phase 2: Places Autocomplete for Building (High impact)
1. Add second autocomplete instance filtered to `establishment` type
2. Bias results to the location selected in Phase 1 (use lat/lng from step 3)
3. Auto-fill building name + website from place data
4. Store `placeId` for potential future use

### Phase 3: Gemini Maps Grounding (Enriches AI research)
1. Add `googleMaps` tool to apartment-research API
2. Update prompt to leverage Maps data for neighborhood context
3. Test that it enriches building research quality

### Phase 4: Curated Buildings (Nice-to-have)
1. Build initial dataset for Chicago, LA, NYC, SF
2. Show as suggestions after city selection
3. Cache research results for instant onboarding

---

## Dependencies & Considerations

| Item | Detail |
|------|--------|
| **API Key** | Need Google Maps Platform API key with Places API (New) enabled |
| **Billing** | Places Autocomplete ~$2.83/1k sessions; Maps grounding priced per Gemini call |
| **Bundle size** | Google Maps JS API loads async, ~50-100KB; no impact on initial bundle |
| **Existing key** | Already have `GOOGLE_API_KEY` for Gemini — may need a separate key for Maps, or enable Maps on same project |
| **Deprecation** | Must use `PlaceAutocompleteElement` (new), NOT legacy `Autocomplete` class |
| **Fallback** | Keep manual text inputs as fallback if Places API is unavailable |
| **DB changes** | Consider adding `place_id` and `lat`/`lng` columns to `projects` table |
