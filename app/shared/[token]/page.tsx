import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSharedDesignByToken } from "@/lib/supabase/public-share";
import { SharedDesignView } from "./SharedDesignView";
import { isValidSnapshot } from "./snapshot-guard";

export type SharedDesign = {
  id: string;
  title: string;
  room_type: string | null;
  stage: "assessment" | "full";
  thumbnail_url: string | null;
  created_at: string;
  snapshot: {
    assessment: {
      what_it_needs: Array<{
        category: string;
        search_title?: string;
        description: string;
        priority: string;
        specs: string;
      }>;
      what_works: string[];
      what_should_go: string[];
      design_direction: string;
      room_description: string;
      mockup_url?: string | null;
    };
    products?: {
      per_tier_products: Record<
        string,
        Array<{
          title: string;
          price: number | null;
          retailer: string;
          product_url: string | null;
          image_url: string | null;
          category: string;
        }>
      >;
    };
    metadata?: {
      building_name?: string;
    };
  };
};

// React.cache deduplicates per-request across both generateMetadata and the
// page component — Next.js runs them in the same request context.
const getSharedDesign = cache(async (token: string): Promise<SharedDesign | null> => {
  // The token is the credential, so the lookup goes through the one module that
  // binds share_token AND is_public server-side — the anon client's RLS policy
  // could never require the token filter. See lib/supabase/public-share.ts.
  const data = await readSharedDesignByToken(token);

  if (!data) return null;

  const row = data as unknown as SharedDesign;

  // A public row whose snapshot is missing/malformed (an older or partially
  // written save) would otherwise 500 the page — generateMetadata and the view
  // both dereference `snapshot.assessment`. Treat it as not-found so a shared
  // link degrades to a clean 404 instead of a crash on a public growth surface.
  if (!isValidSnapshot(row.snapshot)) return null;

  return {
    id: row.id,
    title: row.title,
    room_type: row.room_type,
    stage: row.stage,
    thumbnail_url: row.thumbnail_url,
    created_at: row.created_at,
    snapshot: row.snapshot as SharedDesign["snapshot"],
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const design = await getSharedDesign(token);

  if (!design) {
    return { title: "Design not found | AptDesigner" };
  }

  const appTitle = `${design.title} | AptDesigner`;
  const raw =
    design.snapshot.assessment?.design_direction ||
    design.snapshot.assessment?.room_description ||
    "";
  const description =
    raw.length > 155 ? `${raw.slice(0, 152)}…` : raw || "An AI-designed room by AptDesigner.";
  const image =
    design.snapshot.assessment?.mockup_url ?? design.thumbnail_url ?? null;

  return {
    title: appTitle,
    description,
    openGraph: {
      title: appTitle,
      description,
      type: "website",
      siteName: "AptDesigner",
      ...(image ? { images: [{ url: image, alt: appTitle }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: appTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function SharedDesignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const design = await getSharedDesign(token);

  if (!design) notFound();

  return <SharedDesignView design={design} />;
}
