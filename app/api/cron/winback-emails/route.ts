// Daily cron: send win-back sequence emails (E2/E3) to subscribers whose
// billing was cancelled 7 and 30 days ago.
//
// The E1 win-back ("sorry to see you go") fires immediately on the cancellation
// transition from the Stripe webhook (app/api/billing/webhook/route.ts). E2 and
// E3 are the day-7 and day-30 follow-ups — the re-engagement tail that turns a
// one-shot cancel email into a churn-recovery funnel (docs/email-lifecycle.md
// Sequence 5).
//
// Schedule: runs once per day at 11:00 UTC (vercel.json), offset from the
// activation cron so the two don't contend.
// Auth: Authorization: Bearer $CRON_SECRET — Vercel includes this automatically
//   when CRON_SECRET is set in the deployment environment.
// Dry-run safe: if RESEND_API_KEY is absent, emails are logged but not sent.
//
// Stage-send idempotency: each stage is written to user_email_stages
// (migration 025, unique (user_id, stage)) after send so re-runs never
// double-send the same stage.
//
// Cancellation-time proxy: stripe_customers has no dedicated `cancelled_at`
// column, so `updated_at` stands in for it — the webhook sets updated_at=now()
// when it writes status='cancelled' (same approximation lib/growth/metrics.ts
// uses for cancelled_30d). A user who re-subscribes flips status back to
// 'active' and correctly drops out of the win-back window.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import {
  buildWinBackEmail2,
  buildWinBackEmail3,
} from "@/lib/email/templates/lifecycle";
import type { EmailStage } from "@/lib/email/types";

type StageConfig = {
  daysAgo: number;
  stage: EmailStage;
  builder: (url: string) => { subject: string; html: string; text: string };
};

const STAGES: StageConfig[] = [
  { daysAgo: 7, stage: "winback_2", builder: buildWinBackEmail2 },
  { daysAgo: 30, stage: "winback_3", builder: buildWinBackEmail3 },
];

// ±12 hours around the target day. Wider than the activation window because the
// cancellation timestamp is a proxy (updated_at), so the exact hour is fuzzier;
// idempotency (unique stage per user) still prevents any double-send.
const WINDOW_HOURS = 12;

// Loops over the day's win-back candidates and sends one email per user
// (each provider call is abort-bounded inside sendEmail). A large cohort must
// not be killed mid-loop by the platform default, which would leave the run
// partially sent.
export const maxDuration = 300;

function tokenMatches(provided: string, expected: string): boolean {
  const key = "cron-auth-compare";
  const a = createHmac("sha256", key).update(provided).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

type StageSummary = {
  stage: EmailStage;
  candidates: number;
  sent: number;
  skipped: number;
  errors: number;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Not configured — return 503 so Vercel retries rather than marking the
    // cron permanently failed. The owner sets CRON_SECRET to activate.
    return NextResponse.json(
      { error: "Cron endpoint is not configured." },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin client unavailable." },
      { status: 503 },
    );
  }

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://aptdesignerai.com"
  ).replace(/\/+$/, "");

  const results: StageSummary[] = [];

  for (const { daysAgo, stage, builder } of STAGES) {
    const windowStartMs = Date.now() - (daysAgo * 24 + WINDOW_HOURS) * 3_600_000;
    const windowEndMs = Date.now() - (daysAgo * 24 - WINDOW_HOURS) * 3_600_000;
    const windowStart = new Date(windowStartMs).toISOString();
    const windowEnd = new Date(windowEndMs).toISOString();

    const { data: cancelled, error: cancelledErr } = await admin
      .from("stripe_customers")
      .select("user_id")
      .eq("status", "cancelled")
      .gte("updated_at", windowStart)
      .lt("updated_at", windowEnd);

    if (cancelledErr) {
      console.error(
        `[winback-cron] stripe_customers query error for ${stage}:`,
        cancelledErr.message,
      );
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 1 });
      continue;
    }

    const candidates = cancelled ?? [];
    if (!candidates.length) {
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const { user_id: userId } of candidates) {
      // Idempotency check: has this stage already been sent?
      const { data: alreadySent } = await admin
        .from("user_email_stages")
        .select("id")
        .eq("user_id", userId)
        .eq("stage", stage)
        .maybeSingle();
      if (alreadySent) {
        skipped++;
        continue;
      }

      // Win-back nudges are MARKETING — honour the user's opt-out (CAN-SPAM).
      if (await isMarketingOptedOut(userId, admin)) {
        skipped++;
        continue;
      }

      // Look up email address from auth.users.
      const { data: userData, error: userErr } =
        await admin.auth.admin.getUserById(userId);
      const email = userData?.user?.email;
      if (userErr || !email) {
        console.error(
          `[winback-cron] could not get email for ${userId}:`,
          userErr?.message ?? "missing email",
        );
        errors++;
        continue;
      }

      // Build and send.
      const { subject, html, text } = builder(siteUrl);
      const result = await sendEmail({ to: email, subject, html, text, stage });

      if (result.error) {
        console.error(
          `[winback-cron] send failed for ${userId} (${stage}):`,
          result.error,
        );
        errors++;
        continue;
      }

      // Record the send. ON CONFLICT the unique (user_id, stage) constraint
      // safely ignores a duplicate (race-safe).
      const { error: insertErr } = await admin
        .from("user_email_stages")
        .insert({ user_id: userId, stage, dry_run: result.dryRun });
      if (insertErr && !insertErr.message.includes("duplicate")) {
        console.error(
          `[winback-cron] failed to record send for ${userId} (${stage}):`,
          insertErr.message,
        );
      }

      sent++;
    }

    results.push({ stage, candidates: candidates.length, sent, skipped, errors });
  }

  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  console.info(
    `[winback-cron] done — sent: ${totalSent}, errors: ${totalErrors}`,
    results,
  );

  return NextResponse.json({ ok: true, results });
}
