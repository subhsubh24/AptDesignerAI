import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("skeleton-pulse", className)} />;
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden", className)}>
      <Skeleton className="aspect-square" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2 flex-1 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonBundleCard({ className }: SkeletonProps) {
  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden", className)}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-20 rounded-lg shrink-0" />
          ))}
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function SkeletonCompareRow({ className }: SkeletonProps) {
  return (
    <div className={cn("rounded-2xl border bg-card p-5", className)}>
      <div className="flex gap-4">
        <Skeleton className="h-24 w-24 rounded-xl shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-2 flex-1 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
