// Daily cron: send activation sequence emails (A1/A2/A3) to users who
// signed up but have not started their first room analysis.
//
// Schedule: runs once per day at 10:00 UTC (vercel.json).
// Auth: Authorization: Bearer $CRON_SECRET — Vercel includes this automatically
//   when CRON_SECRET is set in the deployment environment.
// Dry-run safe: if RESEND_API_KEY is absent, emails are logged but not sent.
//
// Stage-send idempotency: each stage is written to user_email_stages
// (migration 025) after send so re-runs never double-send the same stage.
//
// "Has started analysis" proxy: user has at least one project. This catches
// every user who has opened the app; refine to rooms.status if needed later.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import {
  buildActivationEmail1,
  buildActivationEmail2,
  buildActivationEmail3,
} from "@/lib/email/templates/lifecycle";
import type { EmailStage } from "@/lib/email/types";

type StageConfig = {
  daysAgo: number;
  stage: EmailStage;
  builder: (url: string) => { subject: string; html: string; text: string };
};

const STAGES: StageConfig[] = [
  { daysAgo: 1, stage: "activation_1", builder: buildActivationEmail1 },
  { daysAgo: 3, stage: "activation_2", builder: buildActivationEmail2 },
  { daysAgo: 7, stage: "activation_3", builder: buildActivationEmail3 },
];

// ±4 hours around the target day. Running daily means each user falls in
// exactly one window per stage.
const WINDOW_HOURS = 4;

// Loops over the day's activation candidates and sends one email per user
// (each provider call 10s-abort-bounded). A large cohort must not be killed
// mid-loop by the platform default, which would leave the run partially sent.
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

    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("id")
      .gte("created_at", windowStart)
      .lt("created_at", windowEnd);

    if (profilesErr) {
      console.error(
        `[activation-cron] profiles query error for ${stage}:`,
        profilesErr.message,
      );
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 1 });
      continue;
    }

    const candidates = profiles ?? [];
    if (!candidates.length) {
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const { id: userId } of candidates) {
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

      // Has the user opened the app? (any project = engaged)
      const { data: project } = await admin
        .from("projects")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (project) {
        skipped++;
        continue;
      }

      // Activation nudges are MARKETING — honour the user's opt-out (CAN-SPAM).
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
          `[activation-cron] could not get email for ${userId}:`,
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
          `[activation-cron] send failed for ${userId} (${stage}):`,
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
          `[activation-cron] failed to record send for ${userId} (${stage}):`,
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
    `[activation-cron] done — sent: ${totalSent}, errors: ${totalErrors}`,
    results,
  );

  return NextResponse.json({ ok: true, results });
}
