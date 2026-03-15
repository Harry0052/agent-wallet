"use client";

import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { Transaction } from "@/lib/types";
import { cn, fmt, fmtFull } from "@/lib/utils";

function toTitleCase(value: string): string {
  return value
    .split(/[-_ ]+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function deriveVendor(tx: Transaction): string {
  if (tx.merchant) return tx.merchant;

  const sendMatch = tx.description.match(/send to\s+(.+)$/i);
  if (sendMatch) return sendMatch[1].trim();

  const fromMatch = tx.description.match(/from\s+(.+)$/i);
  if (fromMatch) return fromMatch[1].trim();

  if (tx.type === "topup") return "Stripe Funding";
  return "N/A";
}

function deriveTaskTitle(tx: Transaction): string {
  if (tx.metadata?.taskTitle) return tx.metadata.taskTitle;

  if (tx.type === "topup") return "Wallet Top-Up";
  if (tx.type === "send") return "Recipient Transfer";
  if (tx.type === "payout") return "Vendor Purchase";

  return tx.description.length > 56
    ? `${tx.description.slice(0, 56)}...`
    : tx.description;
}

function decisionSummary(tx: Transaction): string {
  if (tx.status === "pending") {
    return "Awaiting settlement confirmation from payment rails.";
  }

  if (tx.status === "failed" || tx.status === "canceled") {
    return "Action did not settle; no completed ledger outcome.";
  }

  if (tx.direction === "credit") {
    return `Credit posted${tx.source ? ` via ${tx.source}` : ""}.`;
  }

  return `Debit settled${tx.source ? ` via ${tx.source}` : ""}.`;
}

export function TransactionHistory({ alwaysShow }: { alwaysShow?: boolean } = {}) {
  const { wallet, showHistory, toggleHistory } = useApp();

  const transactions = useMemo(
    () =>
      [...wallet.transactions].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [wallet.transactions],
  );

  if (!alwaysShow && !showHistory) return null;

  return (
    <section className="aw-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="aw-kicker">Ledger</p>
          <h3 className="text-sm font-semibold text-[var(--aw-text)]">
            Transaction History
          </h3>
        </div>
        <button
          onClick={toggleHistory}
          className="aw-button-secondary px-3 py-1.5 text-xs"
        >
          Close
        </button>
      </div>

      {transactions.length === 0 ? (
        <div className="aw-empty-state px-3 py-6 text-center text-sm text-[var(--aw-text-muted)]">
          No ledger events yet
        </div>
      ) : (
        <div className="aw-scroll max-h-[28rem] overflow-y-auto space-y-2 pr-1">
          <div className="grid grid-cols-[1.45fr_0.9fr_0.9fr] gap-2 px-2 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
            <span>Timestamp / Task</span>
            <span>Action / Vendor</span>
            <span className="text-right">Amount / Status</span>
          </div>

          {transactions.map((tx) => {
            const vendor = deriveVendor(tx);
            const taskTitle = deriveTaskTitle(tx);
            const actionLabel = toTitleCase(tx.type);

            return (
              <article
                key={tx.id}
                className="animate-sheet-rise rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5"
              >
                <div className="grid grid-cols-[1.45fr_0.9fr_0.9fr] gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--aw-text-muted)]">
                      {fmtFull(tx.createdAt)}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-[var(--aw-text)]">
                      {taskTitle}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.06em] text-[var(--aw-text-soft)]">
                      {actionLabel}
                    </p>
                    <p className="mt-1 truncate text-sm text-[var(--aw-text-muted)]">
                      {vendor}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--aw-text)]">
                      {tx.direction === "credit" ? "+" : "-"}
                      {fmt(tx.amount)}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-[10px] uppercase tracking-[0.08em]",
                        tx.status === "pending"
                          ? "text-[var(--aw-warning)]"
                          : tx.status === "failed" || tx.status === "canceled"
                            ? "text-[var(--aw-danger)]"
                            : "text-[var(--aw-text-muted)]",
                      )}
                    >
                      {tx.status}
                    </p>
                  </div>
                </div>

                <div className="mt-2 border-t border-[var(--aw-border)] pt-2">
                  <p className="text-[11px] text-[var(--aw-text-soft)]">
                    {decisionSummary(tx)}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
