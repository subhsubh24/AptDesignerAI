"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { MapPin, Building2, Loader2, Search } from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */

export interface PlaceResult {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  websiteUri?: string;
  types?: string[];
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
}

interface PlaceAutocompleteProps {
  /** "regions" for city/neighborhood, "establishment" for buildings */
  searchType?: "regions" | "establishment";
  /** Restrict to a country (ISO 3166-1 Alpha-2) */
  country?: string;
  /** Bias results near this location */
  locationBias?: { lat: number; lng: number };
  /** Placeholder text */
  placeholder?: string;
  /** Current text value (controlled) */
  value?: string;
  /** Called when text changes (for controlled input) */
  onInputChange?: (value: string) => void;
  /** Called when a place is selected from the dropdown */
  onPlaceSelected?: (place: PlaceResult) => void;
  /** Additional className */
  className?: string;
  /** Icon to show */
  icon?: "pin" | "building" | "search";
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function isGoogleMapsLoaded(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.google?.maps?.places
  );
}

/** Debounce hook */
function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ── Component ────────────────────────────────────────────────────────── */

export function PlaceAutocomplete({
  searchType = "regions",
  country = "us",
  locationBias,
  placeholder = "Search...",
  value: controlledValue,
  onInputChange,
  onPlaceSelected,
  className,
  icon = "search",
}: PlaceAutocompleteProps) {
  const [inputValue, setInputValue] = useState(controlledValue ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Sync controlled value
  useEffect(() => {
    if (controlledValue !== undefined) {
      setInputValue(controlledValue);
    }
  }, [controlledValue]);

  // Check API availability
  useEffect(() => {
    const check = () => setApiAvailable(isGoogleMapsLoaded());
    check();
    if (!isGoogleMapsLoaded()) {
      // Retry a few times as script might still be loading
      const t1 = setTimeout(check, 1000);
      const t2 = setTimeout(check, 3000);
      const t3 = setTimeout(check, 6000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, []);

  // Create session token on mount (groups autocomplete + place details for billing)
  useEffect(() => {
    if (isGoogleMapsLoaded() && !sessionTokenRef.current) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
  }, [apiAvailable]);

  const debouncedInput = useDebounce(inputValue, 300);

  // Fetch suggestions when input changes
  useEffect(() => {
    if (!debouncedInput || debouncedInput.length < 2 || !isGoogleMapsLoaded()) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    let cancelled = false;

    async function fetchSuggestions() {
      setLoading(true);
      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: debouncedInput,
          includedRegionCodes: [country],
          language: "en",
        };

        if (searchType === "regions") {
          request.includedPrimaryTypes = ["locality", "sublocality", "neighborhood", "administrative_area_level_1"];
        } else {
          request.includedPrimaryTypes = ["apartment_complex", "apartment_building", "real_estate_agency"];
        }

        if (locationBias) {
          request.locationBias = new google.maps.Circle({
            center: locationBias,
            radius: 50000, // 50km
          });
        }

        if (sessionTokenRef.current) {
          request.sessionToken = sessionTokenRef.current;
        }

        const { suggestions: results } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

        if (cancelled) return;

        const mapped: Suggestion[] = results
          .filter((r) => r.placePrediction)
          .map((r) => {
            const pred = r.placePrediction!;
            return {
              placeId: pred.placeId,
              mainText: pred.mainText?.text ?? pred.text?.text ?? "",
              secondaryText: pred.secondaryText?.text ?? "",
              types: pred.types ?? [],
            };
          });

        setSuggestions(mapped);
        setIsOpen(mapped.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        console.warn("[PlaceAutocomplete] Fetch error:", err);
        setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSuggestions();
    return () => { cancelled = true; };
  }, [debouncedInput, searchType, country, locationBias]);

  // Select a suggestion
  const handleSelect = useCallback(async (suggestion: Suggestion) => {
    setIsOpen(false);
    setInputValue(suggestion.mainText);
    onInputChange?.(suggestion.mainText);

    if (!isGoogleMapsLoaded()) return;

    try {
      const place = new google.maps.places.Place({ id: suggestion.placeId });
      await place.fetchFields({
        fields: ["displayName", "formattedAddress", "addressComponents", "location", "websiteURI", "types"],
      });

      // Extract city/state/neighborhood from address components
      let city = "";
      let state = "";
      let neighborhood = "";

      for (const comp of place.addressComponents ?? []) {
        if (comp.types.includes("locality")) city = comp.longText ?? "";
        if (comp.types.includes("administrative_area_level_1")) state = comp.shortText ?? "";
        if (comp.types.includes("neighborhood")) neighborhood = comp.longText ?? "";
        if (comp.types.includes("sublocality_level_1") && !neighborhood) neighborhood = comp.longText ?? "";
      }

      const result: PlaceResult = {
        placeId: suggestion.placeId,
        displayName: place.displayName ?? suggestion.mainText,
        formattedAddress: place.formattedAddress ?? "",
        city,
        state,
        neighborhood,
        lat: place.location?.lat(),
        lng: place.location?.lng(),
        websiteUri: place.websiteURI ?? undefined,
        types: place.types ?? [],
      };

      onPlaceSelected?.(result);

      // Reset session token after selection (new session for next search)
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    } catch (err) {
      console.warn("[PlaceAutocomplete] Place details error:", err);
    }
  }, [onPlaceSelected, onInputChange]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const IconComponent = icon === "pin" ? MapPin : icon === "building" ? Building2 : Search;

  // If API isn't loaded, render a plain input as fallback
  if (apiAvailable === false) {
    return (
      <div className={cn("relative", className)}>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <IconComponent className="h-4 w-4" />
        </div>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onInputChange?.(e.target.value);
          }}
          placeholder={placeholder}
          className="w-full h-11 pl-9 pr-4 rounded-xl border bg-background text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring transition-all"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <IconComponent className="h-4 w-4" />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full h-11 pl-9 pr-4 rounded-xl border bg-background text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring transition-all"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls="place-suggestions"
        autoComplete="off"
      />

      {isOpen && suggestions.length > 0 && (
        <ul
          id="place-suggestions"
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-xl border bg-popover shadow-lg max-h-60 overflow-auto py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 cursor-pointer text-sm transition-colors",
                i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before select
                handleSelect(s);
              }}
            >
              <div className="shrink-0 mt-0.5 text-muted-foreground">
                {searchType === "establishment" ? (
                  <Building2 className="h-4 w-4" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{s.mainText}</div>
                {s.secondaryText && (
                  <div className="text-xs text-muted-foreground truncate">{s.secondaryText}</div>
                )}
              </div>
            </li>
          ))}
          <li className="px-3 py-1.5 text-[10px] text-muted-foreground text-right">
            Powered by Google
          </li>
        </ul>
      )}
    </div>
  );
}
