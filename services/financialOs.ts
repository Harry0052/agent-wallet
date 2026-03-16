import type {
  DeterministicReceiptParseResult,
  FinancialDocumentHook,
  FinancialNotification,
  UnifiedFinancialAccountDashboard,
} from "@/lib/server/financialOs/types";

function toError(payload: { error?: string; errorCode?: string }): Error {
  if (payload.errorCode && payload.error) return new Error(`${payload.errorCode}: ${payload.error}`);
  return new Error(payload.error || "Request failed");
}

export async function fetchFinancialOsDashboard(input?: {
  sync?: boolean;
}): Promise<UnifiedFinancialAccountDashboard> {
  const url = new URL("/api/financial-os/dashboard", window.location.origin);
  if (input?.sync) {
    url.searchParams.set("sync", "1");
  }
  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    dashboard?: UnifiedFinancialAccountDashboard;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !payload.ok || !payload.dashboard) {
    throw toError(payload);
  }
  return payload.dashboard;
}

export async function fetchFinancialNotifications(limit = 30): Promise<FinancialNotification[]> {
  const response = await fetch(`/api/financial-os/notifications?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    notifications?: FinancialNotification[];
    error?: string;
    errorCode?: string;
  };
  if (!response.ok || !payload.ok || !Array.isArray(payload.notifications)) {
    throw toError(payload);
  }
  return payload.notifications;
}

export async function dismissFinancialNotification(notificationId: string): Promise<boolean> {
  const response = await fetch("/api/financial-os/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notificationId,
      action: "dismiss",
    }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    dismissed?: boolean;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok || !payload.ok || typeof payload.dismissed !== "boolean") {
    throw toError(payload);
  }
  return payload.dismissed;
}

export async function listFinancialDocumentHooks(limit = 80): Promise<{
  documents: FinancialDocumentHook[];
}> {
  const response = await fetch(`/api/financial-os/documents?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    documents?: FinancialDocumentHook[];
    error?: string;
    errorCode?: string;
  };
  if (!response.ok || !payload.ok || !Array.isArray(payload.documents)) {
    throw toError(payload);
  }
  return {
    documents: payload.documents,
  };
}

export async function createFinancialDocumentHook(input: {
  documentType: FinancialDocumentHook["documentType"];
  fileName: string;
  mimeType: string;
  sourceHash?: string;
  storageProvider?: string;
  storageReference?: string;
  metadata?: Record<string, unknown>;
}): Promise<FinancialDocumentHook> {
  const response = await fetch("/api/financial-os/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    document?: FinancialDocumentHook;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok || !payload.ok || !payload.document) {
    throw toError(payload);
  }
  return payload.document;
}

export async function parseReceipt(input: {
  rawText: string;
  enableFallback?: boolean;
}): Promise<DeterministicReceiptParseResult> {
  const response = await fetch("/api/financial-os/receipts/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    receipt?: DeterministicReceiptParseResult;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok || !payload.ok || !payload.receipt) {
    throw toError(payload);
  }
  return payload.receipt;
}
