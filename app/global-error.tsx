"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#faf9f7" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              maxWidth: "28rem",
              width: "100%",
              border: "1px solid rgba(220,38,38,0.2)",
              borderRadius: "1.25rem",
              background: "rgba(220,38,38,0.04)",
              padding: "3rem 2rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
              textAlign: "center",
            }}
          >
            <div
              style={{
                height: "3.5rem",
                width: "3.5rem",
                borderRadius: "0.75rem",
                background: "rgba(220,38,38,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AlertCircle style={{ width: "1.75rem", height: "1.75rem", color: "#dc2626" }} />
            </div>
            <div>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
                Something went wrong
              </h2>
              <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0, lineHeight: 1.6 }}>
                {error.message || "An unexpected error occurred. Please reload and try again."}
              </p>
              {error.digest && (
                <p style={{ fontSize: "0.75rem", color: "#9ca3af", fontFamily: "monospace", marginTop: "0.5rem" }}>
                  Error ID: {error.digest}
                </p>
              )}
            </div>
            <button
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "1px solid #d1d5db",
                borderRadius: "0.625rem",
                background: "#ffffff",
                cursor: "pointer",
              }}
            >
              <RotateCcw style={{ width: "1rem", height: "1rem" }} />
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
