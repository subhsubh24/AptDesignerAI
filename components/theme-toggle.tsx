"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => setMounted(true), []);

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-secondary p-1",
        className
      )}
    >
      {(
        [
          { value: "light", icon: Sun },
          { value: "system", icon: Monitor },
          { value: "dark", icon: Moon },
        ] as const
      ).map(({ value, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200",
            mounted && theme === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={`${value.charAt(0).toUpperCase() + value.slice(1)} mode`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
