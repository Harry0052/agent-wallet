import type {
  ToolCatalogItem,
  ToolConnectionType,
  UserToolEventRecord,
  UserToolRecord,
} from '@/lib/types';

function formatApiError(body: { error?: string; errorCode?: string }): string {
  if (body.errorCode && body.error) return `${body.errorCode}: ${body.error}`;
  return body.error || 'Request failed';
}

export async function fetchToolsCatalog(): Promise<ToolCatalogItem[]> {
  const response = await fetch('/api/tools/catalog', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    catalog?: ToolCatalogItem[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!Array.isArray(body.catalog)) {
    throw new Error('Tools catalog response is incomplete');
  }

  return body.catalog;
}

export async function fetchUserTools(): Promise<UserToolRecord[]> {
  const response = await fetch('/api/tools', {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    tools?: UserToolRecord[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!Array.isArray(body.tools)) {
    throw new Error('Tools response is incomplete');
  }

  return body.tools;
}

export async function fetchToolEvents(userToolId: string): Promise<UserToolEventRecord[]> {
  const response = await fetch(`/api/tools/${encodeURIComponent(userToolId)}/events`, {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    events?: UserToolEventRecord[];
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (!Array.isArray(body.events)) {
    throw new Error('Tool events response is incomplete');
  }

  return body.events;
}

export async function connectTool(input: {
  toolKey: string;
  displayName?: string;
  category?: string;
  loginUrl?: string;
  signupUrl?: string;
  supportsOauth?: boolean;
  supportsPasswordLogin?: boolean;
  supportsApiKey?: boolean;
  connectionType: ToolConnectionType;
  secret: string;
  label?: string;
  loginIdentifier?: string;
}): Promise<UserToolRecord> {
  const response = await fetch('/api/tools/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    tool?: UserToolRecord;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.tool) {
    throw new Error(formatApiError(body));
  }

  return body.tool;
}

export async function setToolEnabled(input: {
  userToolId: string;
  enabled: boolean;
}): Promise<UserToolRecord> {
  const endpoint = input.enabled ? 'enable' : 'disable';
  const response = await fetch(`/api/tools/${encodeURIComponent(input.userToolId)}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = (await response.json()) as {
    ok?: boolean;
    tool?: UserToolRecord;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.tool) {
    throw new Error(formatApiError(body));
  }

  return body.tool;
}

export async function reconnectTool(input: {
  userToolId: string;
  secret: string;
  connectionType?: ToolConnectionType;
  loginIdentifier?: string;
  label?: string;
}): Promise<UserToolRecord> {
  const response = await fetch(`/api/tools/${encodeURIComponent(input.userToolId)}/reconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: input.secret,
      connectionType: input.connectionType,
      loginIdentifier: input.loginIdentifier,
      label: input.label,
    }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    tool?: UserToolRecord;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.tool) {
    throw new Error(formatApiError(body));
  }

  return body.tool;
}

export async function registerToolFromSignup(input: {
  toolKey: string;
  displayName: string;
  connectionType: ToolConnectionType;
  loginIdentifier: string;
  category?: string;
  signupUrl?: string;
}): Promise<UserToolRecord> {
  const response = await fetch('/api/tools/register-from-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    tool?: UserToolRecord;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.tool) {
    throw new Error(formatApiError(body));
  }

  return body.tool;
}

export async function removeTool(input: {
  userToolId: string;
  deleteSecrets?: boolean;
}): Promise<void> {
  const response = await fetch(`/api/tools/${encodeURIComponent(input.userToolId)}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deleteSecrets: input.deleteSecrets,
    }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }
}

export async function fetchToolConfig(userToolId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`/api/tools/${encodeURIComponent(userToolId)}/config`, {
    method: 'GET',
    cache: 'no-store',
  });

  const body = (await response.json()) as {
    ok?: boolean;
    config?: Record<string, unknown> | null;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok) {
    throw new Error(formatApiError(body));
  }

  if (body.config && (typeof body.config !== 'object' || Array.isArray(body.config))) {
    throw new Error('Tool config response is invalid');
  }

  return body.config || null;
}

export async function updateToolConfig(input: {
  userToolId: string;
  config: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/tools/${encodeURIComponent(input.userToolId)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: input.config,
    }),
  });

  const body = (await response.json()) as {
    ok?: boolean;
    config?: Record<string, unknown>;
    error?: string;
    errorCode?: string;
  };

  if (!response.ok || !body.ok || !body.config) {
    throw new Error(formatApiError(body));
  }

  return body.config;
}
