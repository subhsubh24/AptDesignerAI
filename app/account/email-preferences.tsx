"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Load = "loading" | "ready" | "error";

/**
 * Marketing-email opt-out toggle (CAN-SPAM). Reads + writes the signed-in user's
 * preference via /api/user/email-preferences. Transactional mail (security,
 * receipts) is unaffected and intentionally not toggleable.
 */
export function EmailPreferences() {
  const [marketingEmails, setMarketingEmails] = useState(true);
  const [load, setLoad] = useState<Load>("loading");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/user/email-preferences");
        if (!active) return;
        if (!res.ok) {
          setLoad("error");
          return;
        }
        const data = (await res.json()) as { marketingEmails?: boolean };
        setMarketingEmails(data.marketingEmails !== false);
        setLoad("ready");
      } catch {
        if (active) setLoad("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggle = async () => {
    if (saving || load !== "ready") return;
    const next = !marketingEmails;
    setSaving(true);
    setStatusMsg("");
    // Optimistic; revert on failure so the UI never claims a save that didn't land.
    setMarketingEmails(next);
    try {
      const res = await fetch("/api/user/email-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketingEmails: next }),
      });
      if (!res.ok) {
        setMarketingEmails(!next);
        setStatusMsg("Couldn't save — please try again.");
      } else {
        setStatusMsg(next ? "Subscribed to product updates." : "Unsubscribed from product updates.");
      }
    } catch {
      setMarketingEmails(!next);
      setStatusMsg("Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-muted-foreground" />
          Email preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Product updates &amp; tips</p>
            <p className="text-sm text-muted-foreground mt-1">
              Occasional emails about new features, design tips, and launch news. You can opt out anytime.
              Account &amp; security emails are always sent.
            </p>
          </div>
          {load === "loading" ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={marketingEmails}
              aria-label="Product updates and tips emails"
              disabled={saving || load !== "ready"}
              onClick={toggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/50 disabled:opacity-60",
                marketingEmails ? "bg-accent-warm" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                  marketingEmails ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          )}
        </div>
        {load === "error" && (
          <p className="text-xs text-destructive">Couldn&apos;t load your preferences. Please refresh.</p>
        )}
        {statusMsg && load === "ready" && (
          <p className="text-xs text-muted-foreground" aria-live="polite">{statusMsg}</p>
        )}
      </CardContent>
    </Card>
  );
}
