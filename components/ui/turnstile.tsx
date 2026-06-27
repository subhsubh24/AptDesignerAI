"use client";

// Cloudflare Turnstile widget (G5). Renders the bot-protection challenge and
// hands the resulting token to the parent. Renders nothing unless a public site
// key is configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY), so forms degrade to their
// pre-Turnstile behaviour until the owner connects Cloudflare. Loads the
// Cloudflare script once and renders explicitly so it survives React re-renders.

import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function Turnstile({
  onToken,
  className,
}: {
  /** Called with the token on success, or null when it errors/expires. */
  onToken: (token: string | null) => void;
  className?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest callback without re-running the render effect (which would
  // re-render the widget) when the parent passes a new function identity.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return; // already rendered
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        "error-callback": () => onTokenRef.current(null),
        "expired-callback": () => onTokenRef.current(null),
        theme: "auto",
        size: "flexible",
      });
    };

    let scriptEl: HTMLScriptElement | null = null;
    if (window.turnstile) {
      renderWidget();
    } else {
      scriptEl = document.querySelector<HTMLScriptElement>(
        'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
      );
      if (!scriptEl) {
        scriptEl = document.createElement("script");
        scriptEl.src = SCRIPT_SRC;
        scriptEl.async = true;
        scriptEl.defer = true;
        document.head.appendChild(scriptEl);
      }
      scriptEl.addEventListener("load", renderWidget);
    }

    return () => {
      cancelled = true;
      // Remove the load listener so a remounting component doesn't accumulate
      // stale handlers on the shared script element.
      scriptEl?.removeEventListener("load", renderWidget);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget already gone — nothing to clean up
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} className={className} />;
}
