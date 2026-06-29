import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Privacy Policy — AptDesigner",
  description: "How AptDesigner handles your photos, designs, and personal data.",
};

export default function PrivacyPage() {
  const updatedDate = "April 16, 2026";

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
            <h2 className="text-xl font-semibold mb-3">Your rights</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Access and export your data at any time.</li>
              <li>Delete your account — we remove all your content within 30 days.</li>
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
              AptDesigner is intended for users 16 and older. If you believe a
              child has created an account, contact us and we&apos;ll delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p className="text-muted-foreground">
              Questions or data requests? Email{" "}
              <a href="mailto:hello@aptdesigner.app" className="text-accent-warm font-medium hover:underline">
                hello@aptdesigner.app
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
