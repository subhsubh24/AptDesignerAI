"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, CheckCircle2, Copy, Gift, Loader2, MailCheck } from "lucide-react";
import { Turnstile } from "@/components/ui/turnstile";
import { buildReferralShareUrl } from "@/lib/waitlist/referral";

type State = "idle" | "loading" | "pending" | "duplicate" | "error";

// Bot protection is active only once the owner sets the public site key; until
// then the widget renders nothing and the form behaves exactly as before.
const CAPTCHA_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Referral: the inbound code we attribute this sign-up to, and the code the
  // server hands back so this subscriber can invite friends in turn. Read
  // `?ref=` once via a lazy initializer (client-only — avoids both a
  // useSearchParams Suspense bailout and a set-state-in-effect).
  const [inboundRef] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("ref");
  });
  const [referralCode, setReferralCode] = useState<string | null>(null);

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || state === "loading") return;
    if (CAPTCHA_ENABLED && !captchaToken) {
      setErrorMsg("Please complete the verification below.");
      setState("error");
      return;
    }

    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), turnstileToken: captchaToken, ref: inboundRef }),
      });
      const data = (await res.json()) as {
        pendingConfirmation?: boolean;
        alreadySubscribed?: boolean;
        referralCode?: string | null;
        error?: string;
      };

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setState("error");
        return;
      }

      if (data.referralCode) setReferralCode(data.referralCode);

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
        <ReferralShare code={referralCode} />
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
        <ReferralShare code={referralCode} />
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
      {/* ONLY the in-flight request disables this. Every other reason a submit
          could fail is better said than shown, and both already are: the input
          is `type="email" required`, so an empty or malformed address gets the
          browser's own validation bubble focused on the field, and an unsolved
          challenge gets "Please complete the verification below." from
          handleSubmit. Gating the BUTTON on those instead left the primary call
          to action rendering at disabled:opacity-50 on first paint — on the
          pre-launch conversion surface, on a page that already says "Coming
          soon" — with no text explaining what would enable it, and out of the
          tab order, so a keyboard user reached the field and then nothing.
          Caught by LOOKING at the committed F7 capture; the journey assertion
          passed, because it only checks the button is visible. */}
      <Button
        type="submit"
        variant="warm"
        size="lg"
        disabled={state === "loading"}
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
      {/* Bot-protection challenge — renders only when a site key is configured. */}
      <Turnstile onToken={handleCaptchaToken} className="w-full" />
      {state === "error" && errorMsg && (
        <p role="alert" className="text-xs text-destructive w-full mt-1">{errorMsg}</p>
      )}
    </form>
  );
}

/**
 * Post-sign-up referral share card. Each subscriber gets a personal link; the
 * more confirmed friends they bring, the further up the launch list they move.
 * Renders nothing until the server has issued a code.
 */
function ReferralShare({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  const shareUrl = buildReferralShareUrl(
    typeof window !== "undefined" ? window.location.origin : "",
    code,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the link is still
      // selectable in the field, so this is a non-fatal best-effort copy.
    }
  };

  return (
    <div className="mt-4 w-full max-w-xs rounded-xl border bg-card/50 p-4 text-center">
      <div className="flex items-center justify-center gap-2 text-sm font-semibold">
        <Gift className="h-4 w-4 text-accent-warm" />
        Jump the line
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Invite a friend with your link — each confirmed sign-up moves you up the list.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Your referral link"
          className="flex-1 h-9 rounded-lg border bg-background px-3 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-warm/50"
        />
        <Button type="button" variant="outline" size="sm" onClick={copy} aria-label="Copy referral link" className="shrink-0">
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {/* Announce the copy result to screen readers (the icon change alone is silent). */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Referral link copied to clipboard" : ""}
      </span>
    </div>
  );
}
