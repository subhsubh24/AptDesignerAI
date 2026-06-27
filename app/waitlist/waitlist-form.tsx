"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Loader2, MailCheck } from "lucide-react";

type State = "idle" | "loading" | "pending" | "duplicate" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || state === "loading") return;

    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as {
        pendingConfirmation?: boolean;
        alreadySubscribed?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setState("error");
        return;
      }

      if (data.alreadySubscribed) {
        setState("duplicate");
        return;
      }

      // Double opt-in: address stored as pending; the user must click the link
      // in the confirmation email before they're counted on the list.
      setState("pending");
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setState("error");
    }
  };

  if (state === "pending") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
          <MailCheck className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="text-base font-semibold">Check your inbox</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          We sent a confirmation link to <span className="font-medium text-foreground">{email.trim()}</span>.
          Click it to lock in your spot — that&apos;s the only way we&apos;ll add you.
        </p>
      </div>
    );
  }

  if (state === "duplicate") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-warm/10">
          <CheckCircle2 className="h-6 w-6 text-accent-warm" />
        </div>
        <p className="text-base font-semibold">Already saved!</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          That address is already on our launch list. We&apos;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row flex-wrap gap-3 w-full max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state === "error") { setState("idle"); setErrorMsg(""); }
        }}
        placeholder="your@email.com"
        disabled={state === "loading"}
        className="flex-1 h-11 rounded-xl border bg-background px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-warm/50 disabled:opacity-60 transition"
        aria-label="Email address"
      />
      <Button
        type="submit"
        variant="warm"
        size="lg"
        disabled={state === "loading" || !email.trim()}
        className="shrink-0"
      >
        {state === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Joining…
          </>
        ) : (
          <>
            Notify me
            <ArrowRight className="h-4 w-4 ml-1" />
          </>
        )}
      </Button>
      {state === "error" && errorMsg && (
        <p className="text-xs text-destructive w-full mt-1">{errorMsg}</p>
      )}
    </form>
  );
}
