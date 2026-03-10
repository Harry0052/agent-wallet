"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LandingPage } from "@/components/LandingPage";

/**
 * Checks URL params and redirects to the appropriate app page,
 * or renders the landing page if no workspace params are present.
 */
export function LandingRedirectGuard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirect = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());

    // Funding returns → redirect to wallet page
    if (params.has("funding_status") || params.has("funding_cancelled") || params.has("session_id")) {
      const walletParams = new URLSearchParams();
      if (params.has("funding_status")) walletParams.set("funding_status", params.get("funding_status")!);
      if (params.has("session_id")) walletParams.set("session_id", params.get("session_id")!);
      if (params.has("funding_cancelled")) walletParams.set("funding_cancelled", "1");
      return `/wallet?${walletParams.toString()}`;
    }

    // Workspace flag → redirect to operator
    if (params.get("workspace") === "1") {
      const dest = params.get("demo") === "1" ? "/operator?demo=1" : "/operator";
      const surface = params.get("surface");
      if (surface === "live") return params.get("demo") === "1" ? "/execution?demo=1" : "/execution";
      if (surface === "controls") return "/wallet";
      return dest;
    }

    // Demo flag alone → operator with demo
    if (params.get("demo") === "1") {
      return "/operator?demo=1&entry=landing";
    }

    return null;
  }, [searchParams]);

  useEffect(() => {
    if (redirect) {
      router.replace(redirect);
    }
  }, [redirect, router]);

  // If redirecting, show nothing (brief flash)
  if (redirect) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--aw-bg)]">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-[var(--aw-primary)]" />
      </div>
    );
  }

  return <LandingPage />;
}
