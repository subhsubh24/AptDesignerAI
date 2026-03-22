"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";

const navigation = [
  { name: "My Apartment", href: "/dashboard", icon: Home },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-sidebar">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <Sparkles className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold tracking-tight">AptDesigner</span>
      </div>
      <ScrollArea className="flex-1 py-4">
        <nav className="flex flex-col gap-1 px-3">
          {navigation.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
      <div className="border-t p-4" />
    </div>
  );
}
