"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Trash2, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EmailPreferences } from "./email-preferences";

const CONFIRM_PHRASE = "delete my account";

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (confirmText.trim().toLowerCase() !== CONFIRM_PHRASE) return;
    setDeleting(true);
    setError("");

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      const data = (await res.json()) as { error?: string; success?: boolean };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setDeleting(false);
        return;
      }

      await supabase.auth.signOut();
      router.push("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account preferences and data.
        </p>
      </div>

      {/* Account info placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-muted-foreground" />
            Your account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            View your profile, change your password, and manage connected services from your{" "}
            <a href="/faq" className="underline underline-offset-4 hover:text-foreground transition-colors">
              help center
            </a>
            .
          </p>
        </CardContent>
      </Card>

      {/* Email preferences (CAN-SPAM opt-out) */}
      <EmailPreferences />

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-sm text-muted-foreground mt-1">
              Permanently delete your account and all associated data — photos, designs,
              product picks, and room analyses. This cannot be undone.
            </p>
          </div>

          {!showConfirm ? (
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/5 hover:border-destructive"
              onClick={() => setShowConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete my account
            </Button>
          ) : (
            <div className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">
                This will immediately and permanently delete your account and all data.
              </p>
              <div className="space-y-2">
                <label htmlFor="confirm-delete" className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm
                </label>
                <input
                  id="confirm-delete"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  className={cn(
                    "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none",
                    "focus:ring-2 focus:ring-destructive/30 focus:border-destructive/50",
                    "placeholder:text-muted-foreground/50 transition-colors",
                  )}
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={confirmText.trim().toLowerCase() !== CONFIRM_PHRASE || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? "Deleting…" : "Delete my account forever"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmText("");
                    setError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
