"use client";

/**
 * Confirmation UI for a single `IdentifiedProduct` entry.
 *
 * Renders three-state chip: "We think this is an IKEA KIVIK — is that right?
 * [Yes] [No] [Different model]". Tapping Yes/No PATCHes the confirm endpoint;
 * Different model opens a typeahead-backed CorrectionModal that hits the
 * correct endpoint instead.
 *
 * Intentionally self-contained — state lives here and reports back via
 * `onSettled()` so the parent can re-fetch the diagnosis after a mutation.
 */

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { Check, X, Pencil, Loader2 } from "lucide-react";
import type { IdentifiedProduct } from "@/lib/types/database";

interface Suggestion {
  brand: string;
  model: string;
  variant?: string | null;
  image_url?: string | null;
  source: string;
}

interface IdentifiedProductPillProps {
  product: IdentifiedProduct;
  roomId: string;
  /** Called after a successful confirm/correct so the parent can refresh state. */
  onSettled?: () => void;
}

export function IdentifiedProductPill({
  product,
  roomId,
  onSettled,
}: IdentifiedProductPillProps) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [localConfirmed, setLocalConfirmed] = useState<boolean | null | undefined>(
    product.user_confirmed,
  );
  const [correctOpen, setCorrectOpen] = useState(false);

  const label = [product.brand, product.model, product.variant]
    .filter(Boolean)
    .join(" ");

  async function handleConfirm(confirmed: boolean) {
    setBusy(confirmed ? "yes" : "no");
    try {
      const res = await fetch(
        `/api/rooms/${roomId}/identified-products/confirm`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand: product.brand,
            model: product.model,
            user_confirmed: confirmed,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setLocalConfirmed(confirmed);
      toast.success(
        confirmed ? "Thanks — got it!" : "Marked as incorrect",
        confirmed
          ? `We'll treat "${label}" as a known fixture in this room.`
          : `We'll stop assuming "${label}" is here.`,
      );
      onSettled?.();
    } catch (err) {
      toast.error(
        "Couldn't save",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(null);
    }
  }

  // Already answered — render a static confirmation badge instead of choice UI.
  if (localConfirmed === true) {
    return (
      <Badge variant="success" className="gap-1.5 py-1.5 px-3">
        <Check className="h-3 w-3" />
        Confirmed: {label}
      </Badge>
    );
  }
  if (localConfirmed === false) {
    return (
      <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-muted-foreground">
        <X className="h-3 w-3" />
        Not {label}
      </Badge>
    );
  }

  return (
    <>
      {/* "We think this might be a X — is that right?" is a request for ACTION,
          so it takes the house accent rail + tint, the same treatment the
          Replace-or-remove half of the assessment pair uses
          (lib/utils/assessment-colors.ts). The raw amber it replaced also needed
          hand-paired light/dark weights; the token carries both. */}
      <Card className="p-3 flex flex-wrap items-center gap-2 border-l-4 border-l-accent-warm bg-accent-warm/5">
        <div className="flex-1 min-w-[220px] text-sm">
          <span className="text-muted-foreground">We think this might be a </span>
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground"> — is that right?</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="warm"
            onClick={() => handleConfirm(true)}
            disabled={busy !== null}
            className="h-8"
          >
            {busy === "yes" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Yes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleConfirm(false)}
            disabled={busy !== null}
            className="h-8"
          >
            {busy === "no" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            No
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCorrectOpen(true)}
            disabled={busy !== null}
            className="h-8"
          >
            <Pencil className="h-3.5 w-3.5" />
            Different model
          </Button>
        </div>
      </Card>

      {correctOpen && (
        <CorrectionModal
          roomId={roomId}
          product={product}
          onClose={() => setCorrectOpen(false)}
          onSaved={() => {
            setCorrectOpen(false);
            setLocalConfirmed(false);
            onSettled?.();
          }}
        />
      )}
    </>
  );
}

// ─── CorrectionModal ──────────────────────────────────────────────────

interface CorrectionModalProps {
  roomId: string;
  product: IdentifiedProduct;
  onClose: () => void;
  onSaved: () => void;
}

function CorrectionModal({ roomId, product, onClose, onSaved }: CorrectionModalProps) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState<{ brand: string; model: string; variant: string }>({
    brand: "",
    model: "",
    variant: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced typeahead against the in-memory substring index.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (q.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/identified-products/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (res.ok) {
          const body = await res.json();
          setSuggestions(body.results ?? []);
        } else {
          setSuggestions([]);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q]);

  async function submit(corrected: { brand: string; model: string; variant?: string | null }) {
    if (!corrected.brand.trim() || !corrected.model.trim()) {
      toast.error(
        "Need a brand and model",
        "Pick a suggestion or type both fields in.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/rooms/${roomId}/identified-products/correct`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            original: { brand: product.brand, model: product.model },
            corrected: {
              brand: corrected.brand.trim(),
              model: corrected.model.trim(),
              variant: corrected.variant?.trim() || null,
            },
            source_image_url: product.source_image_url,
            bounding_box: product.bounding_box,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      toast.success(
        "Thanks — updated!",
        `Using ${corrected.brand} ${corrected.model} instead.`,
      );
      onSaved();
    } catch (err) {
      toast.error(
        "Couldn't save correction",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>What is it, actually?</DialogTitle>
          <DialogDescription>
            We guessed{" "}
            <span className="font-medium">
              {product.brand} {product.model}
            </span>
            . Search for the real brand + model — we&apos;ll re-enrich specs
            against your pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="e.g. IKEA KIVIK, Ligne Roset Togo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={submitting}
          />

          {searching ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching…
            </div>
          ) : suggestions.length > 0 ? (
            <div className="max-h-60 overflow-y-auto rounded-lg border divide-y">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.brand}-${s.model}-${i}`}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-60"
                  onClick={() => submit({ brand: s.brand, model: s.model, variant: s.variant })}
                  disabled={submitting}
                  aria-label={`Use ${s.brand}${s.model ? ` ${s.model}` : ""}${s.variant ? ` (${s.variant})` : ""}`}
                >
                  <div className="flex-1">
                    <span className="font-medium">{s.brand}</span>
                    {s.model && (
                      <>
                        {" "}
                        <span>— {s.model}</span>
                      </>
                    )}
                    {s.variant && (
                      <span className="text-muted-foreground"> ({s.variant})</span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {s.source.replace(/_/g, " ")}
                  </span>
                </button>
              ))}
            </div>
          ) : q.trim().length >= 1 ? (
            <div className="text-xs text-muted-foreground px-1">
              No matches. Type the brand and model manually below.
            </div>
          ) : null}

          <div className="space-y-2 pt-2 border-t">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              …or enter manually
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Brand"
                aria-label="Brand"
                value={manual.brand}
                onChange={(e) => setManual((m) => ({ ...m, brand: e.target.value }))}
                disabled={submitting}
              />
              <Input
                placeholder="Model"
                aria-label="Model"
                value={manual.model}
                onChange={(e) => setManual((m) => ({ ...m, model: e.target.value }))}
                disabled={submitting}
              />
            </div>
            <Input
              placeholder="Variant (optional)"
              aria-label="Variant (optional)"
              value={manual.variant}
              onChange={(e) => setManual((m) => ({ ...m, variant: e.target.value }))}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="warm"
            onClick={() =>
              submit({
                brand: manual.brand,
                model: manual.model,
                variant: manual.variant || null,
              })
            }
            disabled={submitting || !manual.brand.trim() || !manual.model.trim()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
