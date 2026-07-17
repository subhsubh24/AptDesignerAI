// Daily cron: send habit-formation sequence emails (B1/B2/B3) to users who ran
// their first room analysis 1, 3, and 7 days ago and have NOT upgraded to a
// paid plan.
//
// This is the second lifecycle moment: activation (Sequence 1) nudges a
// signed-up user to run their first analysis; once they have (the "aha"),
// this sequence turns that single proof-of-value into a habit and an upsell to
// the Apartment plan for their remaining rooms (docs/email-lifecycle.md
// Sequence 2). It fires only while the user is still on the free tier — anyone
// who has upgraded drops out.
//
// Schedule: runs once per day at 12:00 UTC (vercel.json), offset from the
// activation (10:00) and win-back (11:00) crons so the three don't contend.
// Auth: Authorization: Bearer $CRON_SECRET — Vercel includes this automatically
//   when CRON_SECRET is set in the deployment environment.
// Dry-run safe: if RESEND_API_KEY is absent, emails are logged but not sent.
//
// Stage-send idempotency: each stage is written to user_email_stages
// (migration 025, unique (user_id, stage)) after send so re-runs never
// double-send the same stage. A user whose FIRST analysis fell outside a
// window (e.g. a launch backlog) is caught by the earliest matching stage and
// then idempotency-skipped for the later ones, exactly like the activation
// cron.
//
// "First analysis" proxy: a room_diagnoses row created inside the window. The
// row's created_at is the analysis timestamp (rooms.created_at is room-creation,
// not analysis). A user with several analyses in one window is de-duplicated to
// a single send; a returning user who re-analyses long after their first will
// already carry the stage row from that first window and is idempotency-skipped.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailDryRun } from "@/lib/email";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import { hasProEntitlementWeb } from "@/lib/entitlements/web";
import {
  buildHabitEmail1,
  buildHabitEmail2,
  buildHabitEmail3,
} from "@/lib/email/templates/lifecycle";
import type { EmailStage } from "@/lib/email/types";

type StageConfig = {
  daysAgo: number;
  stage: EmailStage;
  builder: (url: string) => { subject: string; html: string; text: string };
};

const STAGES: StageConfig[] = [
  { daysAgo: 1, stage: "habit_1", builder: buildHabitEmail1 },
  { daysAgo: 3, stage: "habit_2", builder: buildHabitEmail2 },
  { daysAgo: 7, stage: "habit_3", builder: buildHabitEmail3 },
];

// ±4 hours around the target day. Running daily means each user's first-analysis
// timestamp falls in exactly one window per stage.
const WINDOW_HOURS = 4;

// Loops over the day's candidates and sends one email per user (each provider
// call is abort-bounded inside sendEmail). A large cohort must not be killed
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

// PostgREST returns the embedded owner chain as a nested object. Non-matching
// rows are excluded by the !inner joins, so each row carries a user_id — but
// stay defensive against a null embed.
type DiagnosisRow = {
  rooms?: { projects?: { user_id?: string } | null } | null;
};

function userIdOf(row: DiagnosisRow): string | undefined {
  return row.rooms?.projects?.user_id ?? undefined;
}

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

    const { data: diagnoses, error: diagnosesErr } = await admin
      .from("room_diagnoses")
      .select("rooms!inner(projects!inner(user_id))")
      .gte("created_at", windowStart)
      .lt("created_at", windowEnd);

    if (diagnosesErr) {
      console.error(
        `[habit-cron] room_diagnoses query error for ${stage}:`,
        diagnosesErr.message,
      );
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 1 });
      continue;
    }

    // One user can have several analyses in a window — de-duplicate to one send.
    const userIds = Array.from(
      new Set(
        ((diagnoses ?? []) as DiagnosisRow[])
          .map(userIdOf)
          .filter((id): id is string => typeof id === "string"),
      ),
    );

    if (!userIds.length) {
      results.push({ stage, candidates: 0, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const userId of userIds) {
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

      // The habit sequence upsells the paid Apartment plan — anyone who has
      // already upgraded (one-time Apartment or a Pro subscription) drops out.
      // hasProEntitlementWeb encapsulates the paid semantics and fails safe
      // (treats an unconfirmable status as paid → no nudge).
      if (await hasProEntitlementWeb(userId)) {
        skipped++;
        continue;
      }

      // Habit nudges are MARKETING — honour the user's opt-out (CAN-SPAM).
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
          `[habit-cron] could not get email for ${userId}:`,
          userErr?.message ?? "missing email",
        );
        errors++;
        continue;
      }

      // CLAIM the stage BEFORE sending. The unique (user_id, stage) constraint
      // means exactly one run wins the claim; a crash AFTER the claim leaves the
      // marker, so a retry SKIPS instead of double-sending (at-most-once, not the
      // at-least-once a send-then-record ordering would give). dry_run starts as a
      // pre-send guess (isEmailDryRun) and is reconciled to the send's actual
      // provider below — sendEmail can still dry-run for other reasons (e.g. a
      // marketing stage with no physical mailing address configured).
      const claimedDryRun = isEmailDryRun();
      const { error: claimErr } = await admin
        .from("user_email_stages")
        .insert({ user_id: userId, stage, dry_run: claimedDryRun });
      if (claimErr) {
        // Duplicate → a concurrent or prior run already claimed/sent this stage.
        if (claimErr.message.includes("duplicate")) {
          skipped++;
          continue;
        }
        // Any other insert failure → cannot safely claim, so do not send.
        console.error(
          `[habit-cron] failed to claim ${stage} for ${userId}:`,
          claimErr.message,
        );
        errors++;
        continue;
      }

      // Build and send.
      const { subject, html, text } = builder(siteUrl);
      const result = await sendEmail({ to: email, subject, html, text, stage });

      if (result.error) {
        // Send failed → RELEASE the claim so a future run can retry this stage.
        const { error: releaseErr } = await admin
          .from("user_email_stages")
          .delete()
          .eq("user_id", userId)
          .eq("stage", stage);
        if (releaseErr) {
          console.error(
            `[habit-cron] failed to release claim after send error for ${userId} (${stage}):`,
            releaseErr.message,
          );
        }
        console.error(
          `[habit-cron] send failed for ${userId} (${stage}):`,
          result.error,
        );
        errors++;
        continue;
      }

      // Reconcile the claim's dry_run with what sendEmail ACTUALLY did — the
      // authoritative signal — so the record isn't wrong when the send routed to
      // the dry-run provider despite a live key (only writes on a mismatch).
      if (result.dryRun !== claimedDryRun) {
        const { error: reconcileErr } = await admin
          .from("user_email_stages")
          .update({ dry_run: result.dryRun })
          .eq("user_id", userId)
          .eq("stage", stage);
        if (reconcileErr) {
          console.error(
            `[habit-cron] failed to reconcile dry_run for ${userId} (${stage}):`,
            reconcileErr.message,
          );
        }
      }

      sent++;
    }

    results.push({ stage, candidates: userIds.length, sent, skipped, errors });
  }

  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  console.info(
    `[habit-cron] done — sent: ${totalSent}, errors: ${totalErrors}`,
    results,
  );

  return NextResponse.json({ ok: true, results });
}
