import Link from "next/link";
import { LogoMark } from "@/components/ui/logo-mark";

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-card/30 mt-24">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2 md:col-span-2 max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <LogoMark className="h-6 w-6 text-foreground" />
              <span className="text-lg font-semibold tracking-tight">
                Apt<span className="text-accent-warm">Designer</span>
              </span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              AI-powered interior design for apartment dwellers. Photos in, fully
              furnished rooms out — scored and validated for your space.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-4">Product</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/#how-it-works" className="hover:text-foreground transition-colors">How it works</Link></li>
              <li><Link href="/gallery" className="hover:text-foreground transition-colors">Gallery</Link></li>
              <li><Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link></li>
              <li><Link href="/signup" className="hover:text-foreground transition-colors">Start free</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-4">Support</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link></li>
              <li><a href="mailto:hello@aptdesignerai.com" className="hover:text-foreground transition-colors">Contact us</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-4">Legal</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link></li>
              <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link></li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-8 border-t text-xs text-muted-foreground">
          <p>© {year} AptDesigner. Designed for apartments, built with care.</p>
          <p className="italic">Furniture that actually belongs in your space.</p>
        </div>
      </div>
    </footer>
  );
}
