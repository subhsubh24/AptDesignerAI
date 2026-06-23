"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, Home } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";

export default function SignupPage() {
  const supabase = createClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      setError((error as { message: string })?.message || "Signup failed");
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
        <div className="relative w-full max-w-md animate-fade-in-up">
          <Card className="border-border/60 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <div className="h-14 w-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                Check your email
              </CardTitle>
              <CardDescription className="text-base mt-1">
                We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
                Click the link to activate your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Link href="/login">
                <Button variant="outline" className="w-full">
                  Back to Sign In
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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

                <Button type="submit" variant="warm" className="w-full h-11" disabled={loading}>
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
