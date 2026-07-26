"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { loginErrorMessage, type LoginErrorLike } from "@/lib/auth/login-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Home, Ruler, Lock, Wallet } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";

// supabase-js puts NO timeout on the auth fetch, so an unreachable or wedged
// auth endpoint leaves the promise pending forever and the submit button stuck
// on its spinner with no way back but a page reload. Bound it (same 15s the
// mobile auth screens use) so a hang becomes a recoverable on-screen error.
const AUTH_TIMEOUT_MS = 15_000;

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Sign-in timed out")), AUTH_TIMEOUT_MS);
        }),
      ]);
      if (error) {
        // Never render provider text: "Email not confirmed" vs "Invalid login
        // credentials" would tell an attacker which addresses have accounts.
        setError(loginErrorMessage(error as LoginErrorLike));
        setLoading(false);
        return;
      }
    } catch (err) {
      // A throw (network failure) or the timeout above — same neutral mapping.
      setError(loginErrorMessage(err as LoginErrorLike));
      setLoading(false);
      return;
    } finally {
      clearTimeout(timer);
    }

    // Stay in the loading state through navigation so the form can't be
    // re-submitted while the dashboard is being pushed.
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <main className="min-h-screen flex">
      {/* Left: Auth Form */}
      <div className="flex-1 flex items-center justify-center bg-background px-6 py-12">
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none lg:hidden" />
        <div className="relative w-full max-w-md animate-fade-in-up">
          {/* Mobile-only condensed value prop — on desktop the full aspirational
              panel (right) carries this, but it is `hidden lg:flex`, so a mobile
              logged-out visitor otherwise sees only the bare form (issue #618). */}
          <div className="lg:hidden mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Your apartment,{" "}
              <span className="text-gradient-warm">but better.</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Expert furniture recommendations scored for your exact space —
              validated for style, scale, and fit.
            </p>
          </div>
          <Card className="border-border/60 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent-warm/10 to-secondary flex items-center justify-center shadow-warm-sm">
                  <LogoMark className="h-8 w-8 text-foreground" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                Welcome back
              </CardTitle>
              <p className="text-base text-muted-foreground mt-1">
                Let&apos;s keep designing.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleLogin} className="space-y-4">
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
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-sm text-accent-warm font-medium hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {error && (
                  <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button type="submit" variant="warm" className="w-full h-11" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Sign In
                </Button>
              </form>

              <p className="text-sm text-muted-foreground text-center mt-6">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="text-accent-warm font-medium hover:underline">
                  Create one
                </Link>
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
          <Home className="h-12 w-12 text-accent-warm/60 mb-6" />
          <h2 className="text-headline text-foreground mb-4">
            Your apartment,{" "}
            <span className="text-gradient-warm">but better.</span>
          </h2>
          <p className="text-muted-foreground max-w-sm leading-relaxed mb-8">
            Expert furniture recommendations scored for your exact space.
            Every piece validated for style, scale, and fit.
          </p>

          {/* Honest capability highlights — verifiable product claims only, no
              invented testimonials, adoption metrics, or ratings until we have
              real, sourced numbers to show (mirrors the signup + landing bar). */}
          <div className="glass rounded-2xl p-6 max-w-sm border border-border/40 shadow-warm-sm text-left space-y-4">
            {[
              { Icon: Ruler, label: "Every pick scored for your room's scale, layout, and light" },
              { Icon: Wallet, label: "Options across every budget — from budget to investment" },
              { Icon: Lock, label: "Your photos are never used to train AI models" },
            ].map(({ Icon, label }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-warm/15">
                  <Icon className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                </div>
                <p className="text-sm text-foreground leading-relaxed">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
