"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Home } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";

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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError((error as { message: string })?.message || "Login failed");
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Auth Form */}
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
                  <Label htmlFor="password">Password</Label>
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

          {/* Testimonial */}
          <div className="glass rounded-2xl p-6 max-w-sm border border-border/40 shadow-warm-sm">
            <p className="text-sm text-foreground leading-relaxed italic mb-4">
              &ldquo;I was skeptical, but the AI nailed my style. Found a coffee table
              I never would have discovered on my own, and it fits perfectly.&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-accent-warm/20" />
              <div className="text-left">
                <p className="text-xs font-medium">Sarah M.</p>
                <p className="text-xs text-muted-foreground">Brooklyn, NY</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
