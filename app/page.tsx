import { Suspense } from "react";
import { LandingRedirectGuard } from "@/components/HomeEntry";

function LandingFallback() {
  return (
    <div className="min-h-screen bg-[var(--aw-bg)]">
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-[var(--aw-primary)]" />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LandingFallback />}>
      <LandingRedirectGuard />
    </Suspense>
  );
}
