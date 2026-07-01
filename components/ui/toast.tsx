"use client";

/**
 * Toast notification system built on Radix UI Toast.
 *
 * Usage:
 *   import { useToast, toast } from "@/components/ui/toast";
 *
 *   // In a component:
 *   const { toasts } = useToast();
 *   toast.success("Diagnosis complete!");
 *   toast.error("Search failed. Please try again.");
 *   toast.info("Generating mockup...");
 */

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X, CheckCircle2, AlertCircle, Info, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Toast Types ─────────────────────────────────────────────

type ToastVariant = "success" | "error" | "info" | "loading" | "celebration";

interface ToastData {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
}

// ─── Toast Store (module-level singleton) ────────────────────

type ToastListener = () => void;

let toastList: ToastData[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  listeners.forEach((l) => l());
}

function addToast(data: Omit<ToastData, "id">) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  toastList = [...toastList, { ...data, id }];
  notify();
  return id;
}

function removeToast(id: string) {
  toastList = toastList.filter((t) => t.id !== id);
  notify();
}

/**
 * Imperative toast API — call from anywhere (no hook needed for dispatching).
 */
export const toast = {
  success: (title: string, description?: string) =>
    addToast({ variant: "success", title, description, duration: 4000 }),
  error: (title: string, description?: string) =>
    addToast({ variant: "error", title, description, duration: 6000 }),
  info: (title: string, description?: string) =>
    addToast({ variant: "info", title, description, duration: 4000 }),
  loading: (title: string, description?: string) =>
    addToast({ variant: "loading", title, description, duration: 30000 }),
  celebration: (title: string, description?: string) =>
    addToast({ variant: "celebration" as ToastVariant, title, description, duration: 5000 }),
  dismiss: (id: string) => removeToast(id),
};

/**
 * Hook to subscribe to toast state (for the ToastProvider component).
 */
export function useToast() {
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return { toasts: toastList, dismiss: removeToast };
}

// ─── Toast UI Components ─────────────────────────────────────

const variantStyles: Record<ToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  error: "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  loading: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  celebration: "border-accent-warm/30 bg-accent-warm/10 text-foreground shadow-warm-md",
};

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  error: <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />,
  info: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
  loading: <Loader2 className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-spin" />,
  celebration: <Sparkles className="h-4 w-4 text-accent-warm" />,
};

function ToastItem({ data, onDismiss }: { data: ToastData; onDismiss: () => void }) {
  return (
    <ToastPrimitive.Root
      className={cn(
        "rounded-lg border px-4 py-3 shadow-lg flex items-start gap-3 pointer-events-auto",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-full",
        "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
        "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform",
        "data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0 data-[swipe=end]:slide-out-to-right-full",
        variantStyles[data.variant]
      )}
      duration={data.duration}
      onOpenChange={(open) => { if (!open) onDismiss(); }}
      // Errors interrupt (assertive); everything else announces politely so a
      // success/info toast doesn't cut off whatever the screen reader is saying.
      type={data.variant === "error" ? "foreground" : "background"}
    >
      <div className="mt-0.5 shrink-0">{variantIcons[data.variant]}</div>
      <div className="flex-1 min-w-0">
        <ToastPrimitive.Title className="text-sm font-medium">
          {data.title}
        </ToastPrimitive.Title>
        {data.description && (
          <ToastPrimitive.Description className="text-xs mt-0.5 opacity-80">
            {data.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/**
 * Toast provider — mount once in your root layout.
 *
 * Usage in app/layout.tsx:
 *   import { ToastProvider } from "@/components/ui/toast";
 *   <ToastProvider />
 */
export function ToastProvider() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map((t) => (
        <ToastItem key={t.id} data={t} onDismiss={() => dismiss(t.id)} />
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 w-[380px] max-w-[90vw] outline-none" />
    </ToastPrimitive.Provider>
  );
}
