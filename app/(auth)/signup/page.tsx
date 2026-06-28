"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Home } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";
import { Turnstile } from "@/components/ui/turnstile";
import { trackEvent } from "@/lib/analytics";

// True when a real Supabase backend is configured. When absent (local/CI
// without a backend) createClient() returns a mock and we sign up against it
// directly instead of POSTing to the server route.
const HAS_SUPABASE_BACKEND = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

// Bot protection is active only once the owner sets the public site key; until
// then the widget renders nothing and the form behaves exactly as before. The
// /api/auth/signup route already verifies the token server-side (fail-open when
// no secret is set), so this is the matching client half — without it, signups
// would break the moment TURNSTILE_SECRET_KEY is set.
const CAPTCHA_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function SignupPage() {
  const supabase = createClient();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (CAPTCHA_ENABLED && !captchaToken) {
      setError("Please complete the verification below.");
      return;
    }

    setLoading(true);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    // 1) Create the account. There is NO email verification (no email pipeline
    //    pre-launch — see PENDING_OPS): the server route creates an already-
    //    confirmed user, so the account is usable immediately. We never claim to
    //    send an email we can't send.
    if (HAS_SUPABASE_BACKEND) {
      let res: Response;
      try {
        res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, fullName, turnstileToken: captchaToken }),
        });
      } catch {
        setError("Network error. Please try again.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data?.error || "Signup failed. Please try again.");
        setLoading(false);
        return;
      }
    } else {
      // Local/dev without a backend: the mock client accepts any sign-up.
      await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    }

    // 2) Establish a session and land in the working app. A failure here stays
    //    NEUTRAL (covers a wrong password on an existing email + transient
    //    errors) so it never reveals whether the address already had an account.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("We couldn't sign you in. Check your details or sign in instead.");
      setLoading(false);
      return;
    }
    trackEvent("signup_complete");
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center bg-background px-6 py-12">
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none lg:hidden" />
        <div className="relative w-full max-w-md animate-fade-in-up">
          <Card className="border-border/60 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent-warm/10 to-secondary flex items-center justify-center shadow-warm-sm">
                  <LogoMark className="h-8 w-8 text-foreground" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                Create your account
              </CardTitle>
              <CardDescription className="text-base mt-1">
                Your apartment, but better.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                {/* Bot-protection challenge — renders only when a site key is configured. */}
                <Turnstile onToken={handleCaptchaToken} className="w-full" />

                <Button
                  type="submit"
                  variant="warm"
                  className="w-full h-11"
                  disabled={loading || (CAPTCHA_ENABLED && !captchaToken)}
                >
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Account
                </Button>
              </form>

              <p className="text-sm text-muted-foreground text-center mt-6">
                Already have an account?{" "}
                <Link href="/login" className="text-accent-warm font-medium hover:underline">
                  Sign in
                </Link>
              </p>
              <p className="text-xs text-muted-foreground/70 text-center mt-4 leading-relaxed">
                By creating an account, you agree to our{" "}
                <Link href="/terms" className="underline underline-offset-2 hover:text-muted-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-muted-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right: Aspirational panel (desktop only) */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-warm/20 via-secondary to-accent" />
        <div className="absolute inset-0 texture-noise" />
        <div className="relative flex flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6 max-w-sm">
            <Home className="h-12 w-12 text-accent-warm/60 mx-auto" />
            <h2 className="text-headline text-foreground">
              Join hundreds of{" "}
              <span className="text-gradient-warm">happy renters</span>
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { stat: "500+", label: "Rooms designed" },
                { stat: "4.9★", label: "Average rating" },
                { stat: "2 min", label: "To first analysis" },
                { stat: "8.2", label: "Avg fit score" },
              ].map((item) => (
                <div key={item.label} className="glass rounded-xl p-4 border border-border/40">
                  <div className="text-xl font-bold text-foreground">{item.stat}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
