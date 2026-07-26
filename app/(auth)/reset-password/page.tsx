"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, KeyRound, LinkIcon } from "lucide-react";

// Minimum enforced by the signup route (MIN_PASSWORD there). Keep them equal —
// a stricter rule here would reject passwords the product already issued.
const MIN_PASSWORD = 6;

// supabase-js puts no timeout on the auth fetch (the reason the login/signup
// forms bound theirs); the same applies to updateUser.
const AUTH_TIMEOUT_MS = 15_000;

// Backstop for the token redemption below. verifyOtp is bounded by nothing on
// the supabase-js side, so without this a wedged auth endpoint would leave a
// locked-out user staring at "Checking your reset link…" forever. On expiry we
// show the expired-link screen, which at least offers a way forward.
const LINK_TIMEOUT_MS = 8_000;

type Status = "checking" | "ready" | "invalid" | "saving" | "done";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  // Establish the recovery session.
  //
  // The token is redeemed EXPLICITLY with verifyOtp rather than left to
  // detectSessionInUrl, and that is load-bearing, not stylistic. Supabase's own
  // /auth/v1/verify redirect returns the session in the URL *fragment* (the
  // implicit flow, because an admin-minted link has no PKCE verifier to pair
  // with) — but createBrowserClient (@supabase/ssr) hardcodes flowType "pkce",
  // and auth-js throws AuthPKCEGrantCodeExchangeError as soon as a pkce client
  // meets an implicit callback. Relying on the fragment would therefore fail
  // for EVERY valid link. So /api/auth/forgot-password mails a link carrying
  // `token_hash`, and we redeem it here ourselves.
  //
  // No token_hash: this is a signed-in user changing their password on purpose,
  // which is a legitimate way to reach this page — hence the getSession check.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === "checking" ? "invalid" : s));
    }, LINK_TIMEOUT_MS);

    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    const tokenHash = params.get("token_hash");

    void (async () => {
      try {
        if (tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (cancelled) return;
          // An expired or already-used link fails here — that is the ONLY
          // reliable signal, so it drives the "expired" screen.
          setStatus(verifyError ? "invalid" : "ready");
          // Drop the one-time token from the address bar so it isn't left in
          // history, bookmarks, or a shared screenshot.
          window.history.replaceState(null, "", window.location.pathname);
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setStatus(data.session ? "ready" : "invalid");
      } catch {
        if (!cancelled) setStatus("invalid");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setStatus("saving");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Await AND check the result: rendering "password changed" on an update
      // that silently failed would lock the user out for good.
      const { error: updateError } = await Promise.race([
        supabase.auth.updateUser({ password }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timed out")), AUTH_TIMEOUT_MS);
        }),
      ]);
      if (updateError) {
        // Provider text is never rendered (G3). The only failures reachable
        // here are a weak/rejected password and an expired recovery session.
        setError(
          "We couldn't set that password. Your reset link may have expired — request a new one.",
        );
        setStatus("ready");
        return;
      }
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setStatus("ready");
      return;
    } finally {
      clearTimeout(timer);
    }

    setStatus("done");
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="relative w-full max-w-md animate-fade-in-up">
        <Card className="border-border/60 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent-warm/10 to-secondary flex items-center justify-center shadow-warm-sm">
                {status === "invalid" ? (
                  <LinkIcon className="h-8 w-8 text-foreground" aria-hidden="true" />
                ) : (
                  <KeyRound className="h-8 w-8 text-foreground" aria-hidden="true" />
                )}
              </div>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {status === "invalid" ? "That link has expired" : "Choose a new password"}
            </CardTitle>
            <p className="text-base text-muted-foreground mt-1">
              {status === "invalid"
                ? "Reset links work once and last about an hour."
                : "Pick something you haven't used here before."}
            </p>
          </CardHeader>

          <CardContent className="pt-4">
            {status === "checking" && (
              <div
                className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Checking your reset link…
              </div>
            )}

            {status === "invalid" && (
              <Button asChild variant="warm" className="w-full h-11">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            )}

            {(status === "ready" || status === "saving" || status === "done") && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    placeholder="Type it once more"
                    value={confirm}
                    onChange={(ev) => setConfirm(ev.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
                  >
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="warm"
                  className="w-full h-11"
                  disabled={status !== "ready"}
                >
                  {status !== "ready" && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  )}
                  Save new password
                </Button>
              </form>
            )}

            <p className="text-sm text-muted-foreground text-center mt-6">
              <Link href="/login" className="text-accent-warm font-medium hover:underline">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
