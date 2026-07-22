import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Privacy Policy — AptDesignerAI",
  description: "How AptDesignerAI handles your photos, designs, and personal data.",
};

export default function PrivacyPage() {
  const updatedDate = "July 12, 2026";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 md:px-8 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-3">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: {updatedDate}</p>
        </div>

        <div className="rounded-2xl bg-secondary/40 border p-6 mb-10 text-sm">
          <p className="font-medium mb-1">The short version</p>
          <p className="text-muted-foreground">
            Your photos and designs are yours. We don&apos;t sell your data. We
            don&apos;t use your content to train public models. You can delete
            everything at any time.
          </p>
        </div>

        <div className="space-y-8 text-[15px] leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-3">What we collect</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>
                <strong className="text-foreground">Account info</strong> — your email, name (if provided),
                and authentication tokens.
              </li>
              <li>
                <strong className="text-foreground">Room content</strong> — photos, floor plans, and notes
                you upload, plus the AI-generated designs we produce for you.
              </li>
              <li>
                <strong className="text-foreground">Usage data</strong> — basic analytics (pages visited,
                features used) to improve the product. No third-party ad trackers.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Device permissions</h2>
            <p className="text-muted-foreground mb-3">
              On our mobile app, we request the device permissions below only when
              you use a feature that needs them. Each is optional — you can decline
              it, or later revoke it in your device settings, in which case the
              feature that relies on it is simply unavailable until you grant it.
            </p>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>
                <strong className="text-foreground">Camera</strong> — to photograph
                your room for design analysis. We use it only while you are taking a
                photo; we don&apos;t access the camera in the background.
              </li>
              <li>
                <strong className="text-foreground">Photo library</strong> — to let
                you pick an existing room photo to analyze. We access only the
                image you select, never your whole library.
              </li>
              <li>
                <strong className="text-foreground">Notifications</strong> — to let
                us tell you when a design you asked for is ready and send occasional
                product updates. Decline it and the app works exactly the same,
                minus the alerts.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How we use your content</h2>
            <p className="text-muted-foreground">
              We process your photos and floor plans with Google&apos;s Gemini AI
              to understand your space, and we use DeepSeek for some text-only
              reasoning (design analysis, never your photos or identifying data),
              strictly to produce your designs. These API providers operate under
              data-processing terms that prohibit training on your content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Third-party services we share data with</h2>
            <p className="text-muted-foreground mb-4">
              To run the product we rely on a small set of vetted processors. Each
              receives only the data it needs, under data-processing terms that
              prohibit using your content to train generic models. We never sell
              your data or share it for advertising.
            </p>
            <ul className="space-y-3 text-muted-foreground list-disc pl-5">
              <li>
                <strong className="text-foreground">Google (Gemini AI)</strong> — your room
                photos, room type, and design context, to understand your space and
                generate designs.
              </li>
              <li>
                <strong className="text-foreground">DeepSeek</strong> — text-only design
                analysis (no photos, no personal data), as a secondary AI provider for
                cost efficiency.
              </li>
              <li>
                <strong className="text-foreground">Supabase</strong> — your email, photos,
                and design data, for database and file storage (US-hosted).
              </li>
              <li>
                <strong className="text-foreground">Stripe</strong> — your name, email, and
                payment details (card data is collected directly by Stripe; we never see it),
                to process subscription payments.
              </li>
              <li>
                <strong className="text-foreground">RevenueCat</strong> — your account ID and
                subscription/purchase status, to manage in-app subscriptions and entitlements
                on mobile.
              </li>
              <li>
                <strong className="text-foreground">Tavily</strong> — product search terms
                derived from your design (e.g. &ldquo;mid-century oak bookshelf&rdquo;), with
                no personal data, to source furniture and décor recommendations.
              </li>
              <li>
                <strong className="text-foreground">Google Maps / Places</strong> — product
                image search terms, with no personal data, to fetch photos of recommended
                products.
              </li>
              <li>
                <strong className="text-foreground">Browserbase</strong> — screenshots of
                public product pages, with no personal data, so our verification agent can
                confirm product images match their descriptions.
              </li>
              <li>
                <strong className="text-foreground">Resend</strong> — your email address, to
                deliver transactional and account emails (e.g. waitlist confirmation, sign-in,
                and billing notices).
              </li>
              <li>
                <strong className="text-foreground">Cloudflare Turnstile</strong> — a bot-check
                token and your IP address on the signup and waitlist forms, to block automated
                abuse. No account content is shared.
              </li>
              <li>
                <strong className="text-foreground">Vercel Web Analytics</strong> — aggregate,
                cookieless usage events (screen views, feature use) with no personal or
                cross-app advertising identifiers.
              </li>
              <li>
                <strong className="text-foreground">Margin</strong> — AI-usage telemetry only
                (token counts, latency, model name, and a design-outcome quality score per
                request) to track our cost-per-result economics. No personal data, photos,
                account identifiers, or prompt content are sent.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">What we never do</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Sell your personal data or content to anyone.</li>
              <li>Share your photos or designs publicly without your explicit action (share link).</li>
              <li>Use your content to train public or generic AI models.</li>
              <li>Track you across the web with third-party ad pixels.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Where your data lives</h2>
            <p className="text-muted-foreground">
              Photos and project data are stored in Supabase (PostgreSQL + object
              storage) in US-hosted regions. All data is encrypted in transit
              (TLS) and at rest.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How long we keep it</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>
                <strong className="text-foreground">Account data</strong> (email, profile) —
                retained until you delete your account.
              </li>
              <li>
                <strong className="text-foreground">Room photos</strong> — retained until you
                delete your account, or until you remove them individually.
              </li>
              <li>
                <strong className="text-foreground">Design history</strong> — retained until you
                delete your account.
              </li>
              <li>
                <strong className="text-foreground">Server logs</strong> — 30-day rolling
                retention, with no user-identifying information beyond IP address; IP addresses
                are not retained beyond 7 days.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your rights</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Access and export your data at any time.</li>
              <li>Delete your account — this immediately and permanently removes all your content.</li>
              <li>Opt out of product emails (we only send transactional + critical messages by default).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Cookies</h2>
            <p className="text-muted-foreground">
              We use essential cookies for authentication and session management.
              We don&apos;t use third-party advertising cookies or cross-site trackers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Children</h2>
            <p className="text-muted-foreground">
              AptDesignerAI is intended for users 16 and older. If you believe a
              child has created an account, contact us and we&apos;ll delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p className="text-muted-foreground">
              Questions or data requests? Email{" "}
              <a href="mailto:hello@aptdesignerai.com" className="text-accent-warm font-medium hover:underline">
                hello@aptdesignerai.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
