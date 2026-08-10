"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, ChevronRight, Menu, X, LayoutDashboard, HelpCircle, FileText, Bookmark, Star, Settings } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils/cn";
import { STEP_MARK } from "@/lib/utils/assessment-colors";

interface TopbarProps {
  user?: {
    email?: string;
    user_metadata?: {
      full_name?: string;
      avatar_url?: string;
    };
  };
  projectName?: string;
  roomName?: string;
  currentStep?: string;
}

const STEP_KEYS = ["setup", "diagnosis", "products", "compare", "bundles", "mockups"];

export function Topbar({ user, projectName, roomName, currentStep }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Drop any client-cached data tied to this session before the redirect.
    // Storage is the only non-cookie surface we persist to today (theme is
    // preserved — it's not user-scoped).
    if (typeof window !== "undefined") {
      try {
        const preserve = new Map<string, string | null>();
        preserve.set("theme", window.localStorage.getItem("theme"));
        window.sessionStorage.clear();
        window.localStorage.clear();
        for (const [k, v] of preserve) if (v !== null) window.localStorage.setItem(k, v);
      } catch {
        // Some privacy modes block storage writes — redirect anyway.
      }
    }
    router.push("/login");
    router.refresh();
  };

  const name = user?.user_metadata?.full_name || user?.email || "User";
  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Build breadcrumbs from pathname
  const breadcrumbs: { label: string; href: string }[] = [];
  if (pathname.startsWith("/projects") || pathname.startsWith("/dashboard")) {
    breadcrumbs.push({ label: "Dashboard", href: "/dashboard" });
  }
  if (projectName && pathname.includes("/projects/")) {
    const projectId = pathname.split("/projects/")[1]?.split("/")[0];
    if (projectId) {
      breadcrumbs.push({ label: projectName, href: `/projects/${projectId}` });
    }
  }
  if (roomName && pathname.includes("/rooms/")) {
    const parts = pathname.split("/rooms/");
    const roomId = parts[1]?.split("/")[0];
    const projectId = pathname.split("/projects/")[1]?.split("/")[0];
    if (roomId && projectId) {
      breadcrumbs.push({ label: roomName, href: `/projects/${projectId}/rooms/${roomId}` });
    }
    const stepFromPath = parts[1]?.split("/")[1];
    if (stepFromPath && STEP_KEYS.includes(stepFromPath)) {
      breadcrumbs.push({
        label: stepFromPath.charAt(0).toUpperCase() + stepFromPath.slice(1),
        href: pathname,
      });
    }
  }

  // Determine active step index for the mini progress indicator
  const activeStepIndex = currentStep ? STEP_KEYS.indexOf(currentStep) : -1;

  // Current-page chip on mobile (last breadcrumb, simplified)
  const mobileCurrentLabel =
    breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].label : "";

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b glass px-4 sm:px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            <LogoMark className="h-6 w-6 text-foreground" />
            <span className="text-base font-semibold tracking-tight hidden sm:inline">
              Apt<span className="text-accent-warm">Designer</span>
            </span>
          </Link>

          {/* Desktop breadcrumbs */}
          {breadcrumbs.length > 1 && (
            <nav className="hidden md:flex items-center gap-1 text-sm min-w-0">
              {breadcrumbs.map((crumb, i) => (
                <div key={crumb.href} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  {i === breadcrumbs.length - 1 ? (
                    <span className="font-medium text-foreground truncate">{crumb.label}</span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </div>
              ))}
            </nav>
          )}

          {/* Mobile current-page chip */}
          {mobileCurrentLabel && breadcrumbs.length > 1 && (
            <div className="md:hidden min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{mobileCurrentLabel}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Mini step indicator (when inside a room) */}
          {activeStepIndex >= 0 && (
            <div className="hidden md:flex items-center gap-1 mr-2">
              {STEP_KEYS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 w-4 rounded-full transition-all duration-300",
                    // Read out of the shared palette, and MEASURED there: these
                    // marks carry their meaning with no text and no icon, so
                    // colour is the only signal and the ladder has to clear the
                    // WCAG 1.4.11 non-text floor. See STEP_MARK for the numbers
                    // and for why `done` is neutral ink rather than a wash of
                    // the accent (a wash measured 1.44:1 against the
                    // not-yet-reached mark — worse than the off-system emerald
                    // it replaced).
                    i < activeStepIndex
                      ? STEP_MARK.done
                      : i === activeStepIndex
                      ? STEP_MARK.current
                      : STEP_MARK.upcoming
                  )}
                />
              ))}
            </div>
          )}

          <ThemeToggle />

          {/* Desktop user menu */}
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full" aria-label="Open account menu">
                  <Avatar className="h-8 w-8 ring-2 ring-border">
                    <AvatarImage src={user?.user_metadata?.avatar_url} alt={name} />
                    <AvatarFallback className="text-xs bg-secondary text-secondary-foreground font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{name}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/saved">
                    <Bookmark className="mr-2 h-4 w-4" />
                    My Designs
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/picks">
                    <Star className="mr-2 h-4 w-4" />
                    My Picks
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/faq">
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Help & FAQ
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/account">
                    <Settings className="mr-2 h-4 w-4" />
                    Account settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile menu trigger */}
          <button
            className="md:hidden h-11 w-11 flex items-center justify-center rounded-lg hover:bg-muted active:scale-95 active:transition-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 top-14 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer panel */}
      <aside
        className={cn(
          "md:hidden fixed left-0 right-0 top-14 z-50 border-b bg-background overflow-hidden transition-all duration-300",
          mobileOpen ? "max-h-[80vh]" : "max-h-0",
        )}
      >
        <nav className="px-4 py-3 flex flex-col gap-1 max-h-[calc(80vh)] overflow-y-auto">
          {/* User block */}
          <div className="flex items-center gap-3 py-3 mb-2 border-b">
            <Avatar className="h-10 w-10 ring-2 ring-border">
              <AvatarImage src={user?.user_metadata?.avatar_url} alt={name} />
              <AvatarFallback className="text-sm bg-secondary text-secondary-foreground font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>

          {/* Full breadcrumb trail on mobile when deeply nested */}
          {breadcrumbs.length > 0 && (
            <div className="flex flex-wrap gap-1 py-2 mb-2 border-b text-xs">
              {breadcrumbs.map((crumb, i) => (
                <div key={crumb.href} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                  <Link
                    href={crumb.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "px-1 py-0.5 rounded transition-colors",
                      i === breadcrumbs.length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {crumb.label}
                  </Link>
                </div>
              ))}
            </div>
          )}

          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
            Dashboard
          </Link>
          <Link
            href="/saved"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <Bookmark className="h-5 w-5 text-muted-foreground" />
            My Designs
          </Link>
          <Link
            href="/picks"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <Star className="h-5 w-5 text-muted-foreground" />
            My Picks
          </Link>
          <Link
            href="/faq"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
            Help & FAQ
          </Link>
          <Link
            href="/pricing"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-5 w-5 text-muted-foreground" />
            Pricing
          </Link>
          <Link
            href="/account"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
          >
            <Settings className="h-5 w-5 text-muted-foreground" />
            Account settings
          </Link>

          <div className="pt-2 mt-2 border-t">
            <button
              onClick={async () => {
                setMobileOpen(false);
                await handleSignOut();
              }}
              className="flex items-center gap-3 py-3 px-3 rounded-lg text-base font-medium text-destructive hover:bg-destructive/5 transition-colors w-full"
            >
              <LogOut className="h-5 w-5" />
              Sign out
            </button>
          </div>
        </nav>
      </aside>
    </>
  );
}
