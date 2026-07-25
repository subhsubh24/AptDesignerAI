"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MailCheck, LifeBuoy } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";
import { Turnstile } from "@/components/ui/turnstile";

// Matches the signup form: the widget renders nothing until the owner sets the
// public site key, and the route's server-side verify fails open until the
// secret is set — so the form behaves exactly as before until both are live.
const CAPTCHA_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Same bound as the login/signup forms: fetch has no default timeout, and a
// wedged endpoint would otherwise strand the button on its spinner.
const REQUEST_TIMEOUT_MS = 15_000;

type Screen =
  | { kind: "form" }
  // The link was genuinely sent (or the address has no account — the response
  // is identical by design, so the copy must cover both without saying which).
  | { kind: "sent" }
  // Honest fallback: the email provider is not connected, so nothing was sent
  // and we must not pretend otherwise.
  | { kind: "unavailable" };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "form" });

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (CAPTCHA_ENABLED && !captchaToken) {
      setError("Please complete the verification below.");
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: captchaToken }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        emailUnavailable?: boolean;
      };
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setScreen(data.emailUnavailable ? { kind: "unavailable" } : { kind: "sent" });
    } catch {
      // Abort or network failure — both leave the user able to retry.
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="relative w-full max-w-md animate-fade-in-up">
        <Card className="border-border/60 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent-warm/10 to-secondary flex items-center justify-center shadow-warm-sm">
                {screen.kind === "sent" ? (
                  <MailCheck className="h-8 w-8 text-foreground" aria-hidden="true" />
                ) : screen.kind === "unavailable" ? (
                  <LifeBuoy className="h-8 w-8 text-foreground" aria-hidden="true" />
                ) : (
                  <LogoMark className="h-8 w-8 text-foreground" />
                )}
              </div>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {screen.kind === "sent"
                ? "Check your inbox"
                : screen.kind === "unavailable"
                  ? "We'll reset it for you"
                  : "Reset your password"}
            </CardTitle>
            <p className="text-base text-muted-foreground mt-1">
              {screen.kind === "sent"
                ? "If that address has an account, a reset link is on its way."
                : screen.kind === "unavailable"
                  ? "Email reset isn't switched on yet — support can do it directly."
                  : "We'll email you a link to choose a new one."}
            </p>
          </CardHeader>

          <CardContent className="pt-4">
            {screen.kind === "form" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>

                {CAPTCHA_ENABLED && <Turnstile onToken={handleCaptchaToken} className="pt-1" />}

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
                  >
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button type="submit" variant="warm" className="w-full h-11" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                  Send reset link
                </Button>
              </form>
            )}

            {screen.kind === "sent" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The link works once and expires in about an hour. If it doesn&apos;t arrive in a
                  few minutes, check your spam folder — or request another one.
                </p>
                <Button
                  variant="outline"
                  className="w-full h-11"
                  onClick={() => setScreen({ kind: "form" })}
                >
                  Try a different address
                </Button>
              </div>
            )}

            {screen.kind === "unavailable" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We haven&apos;t turned on automated reset emails yet, so we didn&apos;t send one
                  — we&apos;d rather tell you than leave you waiting on mail that isn&apos;t
                  coming. Email us from the address on your account and we&apos;ll reset the
                  password for you.
                </p>
                <Button asChild variant="warm" className="w-full h-11">
                  <a href="mailto:hello@aptdesignerai.com?subject=Password%20reset">
                    Email hello@aptdesignerai.com
                  </a>
                </Button>
                <Button asChild variant="outline" className="w-full h-11">
                  <Link href="/support">Visit support</Link>
                </Button>
              </div>
            )}

            <p className="text-sm text-muted-foreground text-center mt-6">
              Remembered it?{" "}
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
