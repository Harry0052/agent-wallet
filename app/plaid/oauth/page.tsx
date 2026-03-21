"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function OAuthHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const oauthStateId = searchParams.get("oauth_state_id");
    if (oauthStateId) {
      sessionStorage.setItem("plaid_oauth_state_id", oauthStateId);
      window.location.replace("/connect");
    }
  }, [searchParams]);

  return null;
}

export default function PlaidOAuthRedirect() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-[var(--aw-text-muted)]">
        Completing account connection...
      </p>
      <Suspense>
        <OAuthHandler />
      </Suspense>
    </div>
  );
}
