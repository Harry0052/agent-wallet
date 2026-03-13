"use client";

import { useMemo } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { ChatMessage, EvidenceData, EvidenceRecord } from "@/lib/types";
import { domainFromUrl, fmt } from "@/lib/utils";
import {
  canSpendSnapshot,
  getDailySpent,
  getMonthlySpent,
} from "@/services/wallet";

function extractEvidence(messages: ChatMessage[]): EvidenceRecord[] {
  const findings: EvidenceRecord[] = [];
  for (const message of messages) {
    if (message.type !== "evidence" || !message.data) continue;
    const data = message.data as EvidenceData;
    if (!Array.isArray(data.findings)) continue;
    findings.push(...data.findings);
  }
  return findings;
}

function evidenceForVendor(
  vendor: string,
  findings: EvidenceRecord[],
): EvidenceRecord[] {
  const normalized = vendor.toLowerCase();
  return findings.filter(
    (finding) =>
      finding.vendorName.toLowerCase().includes(normalized) ||
      normalized.includes(finding.vendorName.toLowerCase()),
  );
}

function merchantAllowed(
  vendor: string,
  allowed: string[],
  blocked: string[],
): { pass: boolean; detail: string } {
  const normalized = vendor.toLowerCase();
  const blockedHit = blocked.some((item) =>
    normalized.includes(item.toLowerCase()),
  );
  if (blockedHit) {
    return { pass: false, detail: "Merchant appears on blocked list." };
  }

  if (allowed.length === 0) {
    return { pass: true, detail: "No allow-list restriction configured." };
  }

  const allowHit = allowed.some((item) =>
    normalized.includes(item.toLowerCase()),
  );
  return allowHit
    ? { pass: true, detail: "Merchant matched configured allow-list." }
    : { pass: false, detail: "Merchant not found in allow-list." };
}

export function StateSheet() {
  const {
    activeTask,
    isProcessing,
    approveTask,
    rejectTask,
    wallet,
    messages,
  } = useApp();

  const approvalOption =
    activeTask?.status === "awaiting-approval"
      ? activeTask.selectedOption
      : null;
  const findings = useMemo(() => extractEvidence(messages), [messages]);
  const vendorEvidence = useMemo(
    () =>
      approvalOption ? evidenceForVendor(approvalOption.name, findings) : [],
    [approvalOption, findings],
  );

  if (approvalOption && activeTask) {
    const amount = approvalOption.price;
    const projectedBalance = wallet.balance - amount;
    const dailySpent = getDailySpent(wallet);
    const monthlySpent = getMonthlySpent(wallet);
    const primaryEvidence = vendorEvidence[0];

    const overallPolicy = canSpendSnapshot(wallet, amount, approvalOption.name);
    const merchantPolicy = merchantAllowed(
      approvalOption.name,
      wallet.settings.allowedMerchants,
      wallet.settings.blockedMerchants,
    );

    const checks = [
      {
        name: "Sufficient balance",
        pass: wallet.balance >= amount,
        detail: `${fmt(wallet.balance)} available now`,
      },
      {
        name: "Max transaction cap",
        pass: amount <= wallet.settings.maxTransaction,
        detail: `${fmt(amount)} / ${fmt(wallet.settings.maxTransaction)}`,
      },
      {
        name: "Daily limit",
        pass: dailySpent + amount <= wallet.settings.dailyLimit,
        detail: `${fmt(dailySpent + amount)} projected / ${fmt(wallet.settings.dailyLimit)}`,
      },
      {
        name: "Monthly budget",
        pass: monthlySpent + amount <= wallet.settings.monthlyBudget,
        detail: `${fmt(monthlySpent + amount)} projected / ${fmt(wallet.settings.monthlyBudget)}`,
      },
      {
        name: "Merchant policy",
        pass: merchantPolicy.pass,
        detail: merchantPolicy.detail,
      },
    ];

    const nextSteps =
      activeTask.category === "send"
        ? [
            "Submit real transfer request to wallet send API.",
            "Attempt Stripe-backed transfer to approved recipient.",
            "Record resulting settlement status in ledger.",
          ]
        : [
            "Prepare checkout flow via live browser execution.",
            "Confirm purchase action and run payment step.",
            "Debit wallet and post ledger record only if transfer settles.",
          ];

    const whySelected = [
      primaryEvidence
        ? `Live evidence from ${domainFromUrl(primaryEvidence.sourceUrl) || "captured source"} for ${primaryEvidence.planName}.`
        : "No vendor-specific evidence card was captured yet in this run.",
      typeof approvalOption.rating === "number"
        ? `Vendor rating signal: ${approvalOption.rating.toFixed(1)} from live options.`
        : "Selection based on available option ranking and budget fit.",
      overallPolicy.allowed
        ? "Current guardrail snapshot allows this action."
        : `Guardrail warning: ${overallPolicy.reason || "policy mismatch detected"}`,
    ];

    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(15,23,42,0.24)] p-3 backdrop-blur-[2px] md:p-6">
        <section className="aw-surface-elevated animate-sheet-rise w-full max-w-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="aw-kicker">Approval Required</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--aw-text)]">
                Authorize Financial Action
              </h3>
              <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
                {approvalOption.name} • {approvalOption.item}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] px-3 py-1.5 text-base font-semibold text-[var(--aw-primary-strong)]">
              {fmt(amount)}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                What happens next
              </p>
              <ul className="mt-2 space-y-1.5">
                {nextSteps.map((step) => (
                  <li key={step} className="text-xs text-[var(--aw-text-soft)]">
                    • {step}
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                Current wallet impact
              </p>
              <div className="mt-2 space-y-1.5 text-xs">
                <div className="flex justify-between text-[var(--aw-text-soft)]">
                  <span>Current balance</span>
                  <span>{fmt(wallet.balance)}</span>
                </div>
                <div className="flex justify-between text-[var(--aw-text-soft)]">
                  <span>Action amount</span>
                  <span>{fmt(amount)}</span>
                </div>
                <div className="flex justify-between text-[var(--aw-text)] font-medium">
                  <span>Projected balance</span>
                  <span>{fmt(projectedBalance)}</span>
                </div>
              </div>
            </article>
          </div>

          <article className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Why this vendor was selected
            </p>
            <ul className="mt-2 space-y-1.5">
              {whySelected.map((reason) => (
                <li key={reason} className="text-xs text-[var(--aw-text-soft)]">
                  • {reason}
                </li>
              ))}
            </ul>
          </article>

          <article className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              Policy checks
            </p>
            <div className="mt-2 space-y-1.5">
              {checks.map((check) => (
                <div
                  key={check.name}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-2.5 py-2"
                >
                  <div>
                    <p className="text-xs text-[var(--aw-text)]">
                      {check.name}
                    </p>
                    <p className="text-[11px] text-[var(--aw-text-muted)]">
                      {check.detail}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-[0.08em] ${check.pass ? "text-[var(--aw-text-soft)]" : "text-[var(--aw-danger)]"}`}
                  >
                    {check.pass ? "pass" : "fail"}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              onClick={() => approveTask(activeTask.id)}
              disabled={isProcessing}
              className={`aw-button-primary py-2.5 text-sm ${isProcessing ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                Approve And Continue
              </span>
            </button>
            <button
              onClick={() => rejectTask(activeTask.id)}
              disabled={isProcessing}
              className={`aw-button-secondary py-2.5 text-sm ${isProcessing ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle size={14} />
                Reject Action
              </span>
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!isProcessing || !activeTask || activeTask.status !== "active") {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30">
      <section className="aw-surface animate-sheet-rise flex items-center gap-3 px-4 py-3">
        <Loader2 size={16} className="animate-spin text-[var(--aw-primary)]" />
        <div>
          <p className="aw-kicker !text-[0.58rem]">Automation</p>
          <p className="text-sm text-[var(--aw-text-soft)]">
            Preparing real execution flow
          </p>
        </div>
      </section>
    </div>
  );
}
