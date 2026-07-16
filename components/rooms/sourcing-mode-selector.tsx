"use client";

import { cn } from "@/lib/utils/cn";
import { Search, Bot, Sparkles } from "lucide-react";

const MODES = [
  {
    value: "manual",
    label: "Manual",
    description: "You find and submit products",
    icon: Search,
  },
  {
    value: "agentic",
    label: "AI Search",
    description: "AI searches and proposes products",
    icon: Bot,
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "AI searches + you add products",
    icon: Sparkles,
  },
] as const;

interface SourcingModeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SourcingModeSelector({ value, onChange }: SourcingModeSelectorProps) {
  return (
    <div role="group" aria-label="Product sourcing mode" className="grid grid-cols-3 gap-3">
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors",
            value === mode.value
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border hover:border-primary/30 text-muted-foreground"
          )}
        >
          <mode.icon className="h-5 w-5" />
          <span className="text-sm font-medium">{mode.label}</span>
          <span className="text-xs">{mode.description}</span>
        </button>
      ))}
    </div>
  );
}
