"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Plaid OAuth redirect handler.
 *
 * After a user authenticates with their bank via OAuth, the bank redirects
 * back to this page with `oauth_state_id` in the query string. Plaid Link
 * must be re-initialized with that state to complete the flow.
 *
 * This page stores the state ID and redirects to the connect page, which
 * picks it up and re-opens Plaid Link in OAuth continuation mode.
 */
export default function PlaidOAuthRedirect() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const oauthStateId = searchParams.get("oauth_state_id");
    if (oauthStateId) {
      sessionStorage.setItem("plaid_oauth_state_id", oauthStateId);
      window.location.replace("/connect");
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-[var(--aw-text-muted)]">
        Completing account connection...
      </p>
    </div>
  );
}
