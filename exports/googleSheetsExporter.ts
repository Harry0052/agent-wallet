import { getGoogleAccessToken } from "@/integrations/googleAuth";
import type { ShortlistedCandidate } from "@/agents/indeedAgent";

export interface GoogleSheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  rowsWritten: number;
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const SHEET_COLUMNS = ["Name", "Title", "Location", "Skills", "Profile Link", "Score"];

export class GoogleSheetsExporter {
  async exportTopCandidates(
    candidates: ShortlistedCandidate[],
  ): Promise<GoogleSheetExportResult> {
    if (candidates.length === 0) {
      throw new Error("Cannot export an empty shortlist.");
    }

    const token = await getGoogleAccessToken(SCOPES);
    const created = await this.createSpreadsheet(token);
    await this.writeRows(token, created.spreadsheetId, candidates.slice(0, 3));
    await this.enableLinkSharing(token, created.spreadsheetId);

    return {
      spreadsheetId: created.spreadsheetId,
      spreadsheetUrl: created.spreadsheetUrl,
      rowsWritten: Math.min(candidates.length, 3),
    };
  }

  private async createSpreadsheet(token: string): Promise<{
    spreadsheetId: string;
    spreadsheetUrl: string;
  }> {
    const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          title: `Indeed Shortlist ${new Date().toISOString().slice(0, 10)}`,
        },
        sheets: [
          {
            properties: {
              title: "Shortlist",
            },
          },
        ],
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          spreadsheetId?: string;
          spreadsheetUrl?: string;
        }
      | null;

    if (!response.ok || !payload?.spreadsheetId) {
      throw new Error(`Failed to create Google Sheet (status ${response.status}).`);
    }

    return {
      spreadsheetId: payload.spreadsheetId,
      spreadsheetUrl:
        payload.spreadsheetUrl ||
        `https://docs.google.com/spreadsheets/d/${payload.spreadsheetId}/edit`,
    };
  }

  private async writeRows(
    token: string,
    spreadsheetId: string,
    candidates: ShortlistedCandidate[],
  ): Promise<void> {
    const values = [
      SHEET_COLUMNS,
      ...candidates.map((candidate) => [
        candidate.name,
        candidate.title,
        candidate.location,
        candidate.skills.join(", "),
        candidate.profile_link,
        candidate.score,
      ]),
    ];

    const range = encodeURIComponent(`Shortlist!A1:F${values.length}`);
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          range: "Shortlist!A1",
          majorDimension: "ROWS",
          values,
        }),
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(
        `Failed to write rows to Google Sheet: ${
          payload?.error?.message || `HTTP ${response.status}`
        }`,
      );
    }
  }

  private async enableLinkSharing(
    token: string,
    spreadsheetId: string,
  ): Promise<void> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          role: "reader",
          type: "anyone",
        }),
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(
        `Failed to create shareable permission: ${
          payload?.error?.message || `HTTP ${response.status}`
        }`,
      );
    }
  }
}
