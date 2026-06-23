import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo-mark";

export default function SharedDesignNotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
      <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center">
        <LogoMark className="h-8 w-8 text-foreground" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Design not found</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        This design link may have expired or been made private by its owner.
      </p>
      <Link href="/signup">
        <Button variant="warm" size="lg">
          Create your own design <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </Link>
    </div>
  );
}
