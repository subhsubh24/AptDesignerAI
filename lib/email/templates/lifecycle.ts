// Lifecycle email templates — AptDesignerAI.
//
// One function per email stage; each returns { subject, html, text }.
// Copy is drawn directly from docs/email-lifecycle.md (the living source of
// truth for tone and messaging). Visual style matches the waitlist confirmation
// template: warm editorial palette, table-based HTML for email-client compat.
//
// All functions accept a `siteUrl` parameter so the app can build correct
// absolute URLs without hardcoding the domain.
//
// Unsubscribe: CAN-SPAM requires a working opt-out link in every marketing
// email. The footer links to `${siteUrl}/account` (where users manage their
// account + email preferences). When your email platform supports per-user
// List-Unsubscribe URLs, pass them via the `unsubscribeUrl` parameter instead.
//
// Keep EmailStage values here in sync with lib/email/types.ts (LIVING ARTIFACTS).

export interface LifecycleEmail {
  subject: string;
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Shared HTML helpers
// ---------------------------------------------------------------------------

function htmlWrap(body: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2722;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ece5db;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:36px 36px 8px 36px;">
                <p style="margin:0 0 20px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#b07a4f;font-weight:600;">AptDesignerAI</p>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 32px 36px;border-top:1px solid #ece5db;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#a39a8f;">
                  You're receiving this because you signed up for AptDesignerAI.
                  <a href="${unsubscribeUrl}" style="color:#a39a8f;">Manage email preferences</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
    <tr>
      <td>
        <a href="${url}" style="display:inline-block;background:#b07a4f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#2b2722;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px 0;font-size:16px;line-height:1.65;color:#4a443c;">${text}</p>`;
}

function unsubLine(url: string): string {
  return `\nTo manage email preferences: ${url}`;
}

// ---------------------------------------------------------------------------
// Sequence 1 — Activation (Days 0–7; user has NOT run their first analysis)
// ---------------------------------------------------------------------------

/**
 * A1 — Day 1 after signup, no analysis started.
 * Stage: activation_1
 */
export function buildActivationEmail1(siteUrl: string): LifecycleEmail {
  const appUrl = `${siteUrl}/dashboard`;
  const accountUrl = `${siteUrl}/account`;
  const subject = "Ready when you are";

  const body = `
    ${h1("Ready when you are")}
    ${p("Thanks for creating your AptDesigner account.")}
    ${p("When you're ready, here's how to get started:")}
    <ol style="margin:0 0 16px 0;padding-left:20px;font-size:16px;line-height:1.8;color:#4a443c;">
      <li>Open the app and tap <strong>New Room</strong></li>
      <li>Upload any photo of the room you want to start with</li>
      <li>Choose the room type</li>
      <li>Wait about 30 seconds</li>
    </ol>
    ${p("The app will tell you what the room's light direction implies for your palette, what's working, what isn't, and what to do about it.")}
    ${p("One room is always free. No card, no trial — just the analysis.")}
    ${ctaButton("Open AptDesigner →", appUrl)}`;

  const text = [
    "Ready when you are",
    "",
    "Thanks for creating your AptDesigner account.",
    "",
    "When you're ready, here's how to get started:",
    "1. Open the app and tap New Room (or visit " + appUrl + ")",
    "2. Upload any photo of the room you want to start with",
    "3. Choose the room type",
    "4. Wait about 30 seconds",
    "",
    "The app will tell you what the room's light direction implies for your palette,",
    "what's working, what isn't, and what to do about it.",
    "",
    "One room is always free. No card, no trial — just the analysis.",
    "",
    appUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

/**
 * A2 — Day 3 after signup, still no analysis.
 * Stage: activation_2
 */
export function buildActivationEmail2(siteUrl: string): LifecycleEmail {
  const appUrl = `${siteUrl}/dashboard`;
  const accountUrl = `${siteUrl}/account`;
  const subject = "The room that bothers you most";

  const body = `
    ${h1("The room that bothers you most")}
    ${p("There's always one room in an apartment that doesn't quite work. You've rearranged it twice; it still feels off.")}
    ${p("Start with that one.")}
    ${p("Upload a photo and AptDesigner will tell you why it feels off — the light direction your palette is fighting, the scale issue that makes it feel cramped, the material conflict you didn't notice.")}
    ${p("30 seconds to find out what the room needs.")}
    ${ctaButton("Start your first analysis →", appUrl)}`;

  const text = [
    "The room that bothers you most",
    "",
    "There's always one room in an apartment that doesn't quite work. You've rearranged it",
    "twice; it still feels off.",
    "",
    "Start with that one.",
    "",
    "Upload a photo and AptDesigner will tell you why it feels off — the light direction",
    "your palette is fighting, the scale issue that makes it feel cramped, the material",
    "conflict you didn't notice.",
    "",
    "30 seconds to find out what the room needs.",
    "",
    appUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

/**
 * A3 — Day 7 after signup, still no analysis (final nudge).
 * Stage: activation_3
 */
export function buildActivationEmail3(siteUrl: string): LifecycleEmail {
  const appUrl = `${siteUrl}/dashboard`;
  const accountUrl = `${siteUrl}/account`;
  const supportUrl = `${siteUrl}/support`;
  const subject = "One thing before we stop bothering you";

  const body = `
    ${h1("One thing before we stop bothering you")}
    ${p("You signed up for AptDesigner a week ago and haven't run your first analysis.")}
    ${p("That's fine — timing is everything.")}
    ${p(`Before we reduce how often we email you: is there something in the way? A technical issue? Not sure what kind of photo works best? <a href="${supportUrl}" style="color:#b07a4f;text-decoration:underline;">We're happy to help.</a>`)}
    ${p("Otherwise — we'll be here when you're ready.")}
    ${p("One room, free, whenever.")}
    ${ctaButton("Try it now →", appUrl)}`;

  const text = [
    "One thing before we stop bothering you",
    "",
    "You signed up for AptDesigner a week ago and haven't run your first analysis.",
    "",
    "That's fine — timing is everything.",
    "",
    "Before we reduce how often we email you: is there something in the way? A technical",
    "issue? Not sure what kind of photo works best? Reply to this email and we'll help.",
    "",
    "Otherwise — we'll be here when you're ready.",
    "",
    "One room, free, whenever.",
    "",
    appUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

// ---------------------------------------------------------------------------
// Sequence 5 — Win-back (churned Pro/Pro Annual subscribers)
// ---------------------------------------------------------------------------

/**
 * E1 — Day 1 after subscription ends.
 * Stage: winback_1
 */
export function buildWinBackEmail1(siteUrl: string): LifecycleEmail {
  const accountUrl = `${siteUrl}/account`;
  const subject = "Your Pro subscription has ended";

  const body = `
    ${h1("Your Pro subscription has ended")}
    ${p("Your AptDesigner Pro subscription ended. Your saved designs and Apartment-plan analyses are still in your account — nothing is deleted.")}
    ${p("If you'd like to continue:")}
    <ul style="margin:0 0 16px 0;padding-left:20px;font-size:16px;line-height:1.8;color:#4a443c;">
      <li><strong>Pro plan</strong>: $49/month — unlimited apartments, client-ready share links, priority support</li>
      <li><strong>Apartment plan</strong>: $29 one-time — your apartment, every room, forever</li>
    </ul>
    ${p("Or stay on the free tier. Your existing designs stay accessible.")}
    ${ctaButton("View your account →", accountUrl)}`;

  const text = [
    "Your Pro subscription has ended",
    "",
    "Your AptDesigner Pro subscription ended. Your saved designs and Apartment-plan",
    "analyses are still in your account — nothing is deleted.",
    "",
    "If you'd like to continue:",
    "- Pro plan: $49/month — unlimited apartments, client-ready share links, priority support",
    "- Apartment plan: $29 one-time — your apartment, every room, forever",
    "",
    "Or stay on the free tier. Your existing designs stay accessible.",
    "",
    accountUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

/**
 * E2 — Day 7 after subscription ends.
 * Stage: winback_2
 */
export function buildWinBackEmail2(siteUrl: string): LifecycleEmail {
  const upgradeUrl = `${siteUrl}/billing/upgrade`;
  const accountUrl = `${siteUrl}/account`;
  const subject = "Still here if you need it";

  const body = `
    ${h1("Still here if you need it")}
    ${p("A week since your Pro subscription ended. Checking in.")}
    ${p("If there's something that wasn't working — a feature that didn't meet expectations, a design output that felt off — reply to this email. We read every response.")}
    ${p("If it was just a budget thing: the Apartment plan ($29, one-time) doesn't expire.")}
    ${ctaButton("See options →", upgradeUrl)}`;

  const text = [
    "Still here if you need it",
    "",
    "A week since your Pro subscription ended. Checking in.",
    "",
    "If there's something that wasn't working — a feature that didn't meet expectations,",
    "a design output that felt off — reply to this email. We read every response.",
    "",
    "If it was just a budget thing: the Apartment plan ($29, one-time) doesn't expire.",
    "",
    upgradeUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

/**
 * E3 — Day 30 after subscription ends (final win-back).
 * Stage: winback_3
 */
export function buildWinBackEmail3(siteUrl: string): LifecycleEmail {
  const appUrl = `${siteUrl}/dashboard`;
  const accountUrl = `${siteUrl}/account`;
  const subject = "Last check-in from AptDesigner";

  const body = `
    ${h1("Last check-in from AptDesigner")}
    ${p("It's been a month since your Pro subscription ended. One more note before we reduce email frequency.")}
    ${p("If you're working on an apartment and want to run it through the AI — even just one room — the free tier is always there.")}
    ${p("Thanks for trying Pro.")}
    ${ctaButton("Open AptDesigner →", appUrl)}`;

  const text = [
    "Last check-in from AptDesigner",
    "",
    "It's been a month since your Pro subscription ended. One more note before we",
    "reduce email frequency.",
    "",
    "If you're working on an apartment and want to run it through the AI — even just",
    "one room — the free tier is always there.",
    "",
    "Thanks for trying Pro.",
    "",
    appUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}

// ---------------------------------------------------------------------------
// Conversion — Welcome to Pro (fires once when a subscription first activates)
// ---------------------------------------------------------------------------

/**
 * Sent on a genuine free→paid transition (checkout completed / subscription
 * first active). The conversion-moment email: confirm the upgrade and point the
 * new subscriber straight at the value they just unlocked. The symmetric
 * counterpart to buildWinBackEmail1 (which fires on cancellation).
 * Stage: paid_welcome_1
 */
export function buildPaidWelcomeEmail1(siteUrl: string): LifecycleEmail {
  const appUrl = `${siteUrl}/dashboard`;
  const accountUrl = `${siteUrl}/account`;
  const subject = "Welcome to AptDesigner Pro";

  const body = `
    ${h1("You're in. Welcome to Pro.")}
    ${p("Your AptDesigner Pro subscription is active — thank you for upgrading. Here's what's now unlocked:")}
    <ul style="margin:0 0 16px 0;padding-left:20px;font-size:16px;line-height:1.8;color:#4a443c;">
      <li>Unlimited apartments and projects — every room, every space</li>
      <li>Cross-room style coherence and AI mockups across the whole apartment</li>
      <li>Client-ready share links and priority support</li>
    </ul>
    ${p("The best next step is to point the AI at a room you've been meaning to redesign.")}
    ${p("You can manage or cancel your subscription anytime from your account.")}
    ${ctaButton("Start designing →", appUrl)}`;

  const text = [
    "You're in. Welcome to Pro.",
    "",
    "Your AptDesigner Pro subscription is active — thank you for upgrading.",
    "Here's what's now unlocked:",
    "- Unlimited apartments and projects — every room, every space",
    "- Cross-room style coherence and AI mockups across the whole apartment",
    "- Client-ready share links and priority support",
    "",
    "The best next step is to point the AI at a room you've been meaning to redesign.",
    "",
    "You can manage or cancel your subscription anytime from your account.",
    "",
    appUrl,
    "",
    "— AptDesigner",
    unsubLine(accountUrl),
  ].join("\n");

  return { subject, html: htmlWrap(body, accountUrl), text };
}
