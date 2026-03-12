import { promises as fs } from "node:fs";
import path from "node:path";

export type LedgerStatus = "completed" | "failed" | "cancelled";

export interface LedgerEntry {
  transaction_id: string;
  wallet_id: string;
  amount: number;
  merchant: string;
  timestamp: string;
  status: LedgerStatus;
}

export interface LedgerEvent {
  event_type: "talent_sourcing";
  result_count: number;
  timestamp: string;
}

export class Ledger {
  private readonly ledgerFilePath: string;

  constructor(ledgerFilePath?: string) {
    this.ledgerFilePath =
      ledgerFilePath ??
      path.join(process.cwd(), "data", "task-executor-ledger.jsonl");
  }

  async logTransaction(entry: LedgerEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.ledgerFilePath), { recursive: true });
    await fs.appendFile(this.ledgerFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async logEvent(event: LedgerEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.ledgerFilePath), { recursive: true });
    await fs.appendFile(this.ledgerFilePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
