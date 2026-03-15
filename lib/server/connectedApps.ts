import 'server-only';

export type ConnectedAppStatus = 'not_connected' | 'connected' | 'reauth_required';

export interface ConnectedAppRecord {
  key: string;
  name: string;
  status: ConnectedAppStatus;
  sourceState: 'Synced' | 'Manual';
  lastSyncedAt: string | null;
  authType: 'oauth' | 'api_key';
}

// Release 1 intentionally exposes only real integrations.
// We currently do not ship any app integrations in production-ready state.
const SUPPORTED_APPS: ConnectedAppRecord[] = [];

export async function listConnectedApps(_userId: string): Promise<ConnectedAppRecord[]> {
  return SUPPORTED_APPS;
}
