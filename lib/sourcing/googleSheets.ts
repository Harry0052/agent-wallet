import 'server-only';
import { createSign } from 'node:crypto';
import type { NormalizedSourcingRequest, StructuredCandidate } from './schemas.ts';
import { formatShortlistRows } from './sheetsRows.ts';
import { getRequiredSecret } from '@/security/secretsManager';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

interface GoogleServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
}

function base64UrlEncode(input: Buffer | string): string {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return source
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function loadConfig(): GoogleServiceAccountConfig {
  const clientEmail = getRequiredSecret('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKeyRaw = getRequiredSecret('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  return { clientEmail, privateKey };
}

function signJwt(config: GoogleServiceAccountConfig, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: config.clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(toSign);
  signer.end();
  const signature = signer.sign(config.privateKey);

  return `${toSign}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const config = loadConfig();
  const assertion = signJwt(config, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' '));

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !payload?.access_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Failed to acquire Google access token: ${reason}`);
  }

  cachedToken = {
    token: payload.access_token,
    expiresAt: now + ((payload.expires_in || 3600) * 1000),
  };

  return payload.access_token;
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function tabNameForTask(taskId: string): string {
  const suffix = taskId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'task';
  return `Shortlist_${suffix}`;
}

async function createSpreadsheet(token: string, taskId: string): Promise<{ spreadsheetId: string; spreadsheetUrl: string; tabName: string }> {
  const tabName = tabNameForTask(taskId);

  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      properties: {
        title: `Agent Wallet Candidate Shortlist ${new Date().toISOString().slice(0, 10)}`,
      },
      sheets: [{
        properties: {
          title: tabName,
        },
      }],
    }),
  });

  const payload = await response.json().catch(() => null) as {
    spreadsheetId?: string;
    spreadsheetUrl?: string;
  } | null;

  if (!response.ok || !payload?.spreadsheetId) {
    throw new Error(`Failed to create Google Sheet (status ${response.status})`);
  }

  return {
    spreadsheetId: payload.spreadsheetId,
    spreadsheetUrl: payload.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${payload.spreadsheetId}/edit`,
    tabName,
  };
}

async function ensureSheetTab(token: string, spreadsheetId: string, tabName: string): Promise<void> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: tabName,
            },
          },
        },
      ],
    }),
  });

  if (response.ok) return;

  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  const message = payload?.error?.message || '';

  // Ignore duplicate-sheet-name conflicts for idempotent retries.
  if (message.toLowerCase().includes('already exists')) return;

  throw new Error(`Failed to create sheet tab: ${message || `status ${response.status}`}`);
}

async function writeRows(token: string, spreadsheetId: string, tabName: string, rows: Array<Array<string | number>>): Promise<void> {
  const range = encodeURIComponent(`${tabName}!A1:K${Math.max(1, rows.length)}`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        range: `${tabName}!A1`,
        majorDimension: 'ROWS',
        values: rows,
      }),
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(`Failed to write rows to Google Sheet: ${payload?.error?.message || response.status}`);
  }
}

export { formatShortlistRows } from './sheetsRows.ts';

export async function exportShortlistToGoogleSheets(input: {
  taskId: string;
  request: NormalizedSourcingRequest;
  shortlist: StructuredCandidate[];
}): Promise<{
  sheetId: string | null;
  sheetUrl: string | null;
  tabName: string | null;
  rowsWritten: number;
  exportedAt: string | null;
}> {
  if (input.shortlist.length === 0) {
    return {
      sheetId: null,
      sheetUrl: null,
      tabName: null,
      rowsWritten: 0,
      exportedAt: null,
    };
  }

  const token = await getAccessToken();
  const configuredSpreadsheetId = (process.env.GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID || '').trim();

  const tabName = tabNameForTask(input.taskId);
  let spreadsheetId = configuredSpreadsheetId;
  let spreadsheetUrl: string;

  if (!spreadsheetId) {
    const created = await createSpreadsheet(token, input.taskId);
    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl = created.spreadsheetUrl;
  } else {
    spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    await ensureSheetTab(token, spreadsheetId, tabName);
  }

  const rows = formatShortlistRows(input);
  await writeRows(token, spreadsheetId, tabName, rows);

  return {
    sheetId: spreadsheetId,
    sheetUrl: spreadsheetUrl,
    tabName,
    rowsWritten: input.shortlist.length,
    exportedAt: new Date().toISOString(),
  };
}
