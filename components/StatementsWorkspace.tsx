"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { fmt, fmtDate } from "@/lib/utils";
import {
  fetchAccountStatement,
  fetchAiSpendingAnalysis,
  fetchConnectedAccounts,
  fetchSuspectedSubscriptions,
  fetchUnifiedStatement,
  type AccountStatement,
  type AiSpendingAnalysisResponse,
  type ConnectedAccount,
  type DetectedSubscription,
  type StatementFilters,
  type UnifiedStatement,
} from "@/services/statements";

interface AccountFilters {
  date_from: string;
  date_to: string;
  merchant: string;
  category: string;
  pending: "" | "true" | "false";
  page: number;
  page_size: number;
}

function defaultAccountFilters(): AccountFilters {
  return {
    date_from: "",
    date_to: "",
    merchant: "",
    category: "",
    pending: "",
    page: 1,
    page_size: 30,
  };
}

function toQueryFilters(filters: AccountFilters): StatementFilters {
  return {
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    merchant: filters.merchant || undefined,
    category: filters.category || undefined,
    pending: filters.pending || undefined,
    page: filters.page,
    page_size: filters.page_size,
  };
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function accountLabel(account: ConnectedAccount): string {
  const nickname = account.nickname.trim();
  if (nickname) return nickname;
  return `${account.institution_name} ••••${account.mask}`;
}

export function StatementsWorkspace() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unified, setUnified] = useState<UnifiedStatement | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [subscriptions, setSubscriptions] = useState<DetectedSubscription[]>([]);
  const [analysis, setAnalysis] = useState<AiSpendingAnalysisResponse | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountStatement, setAccountStatement] = useState<AccountStatement | null>(
    null,
  );
  const [accountFilters, setAccountFilters] = useState<AccountFilters>(
    defaultAccountFilters,
  );
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [unifiedResult, accountsResult, subscriptionsResult, analysisResult] =
        await Promise.all([
          fetchUnifiedStatement(),
          fetchConnectedAccounts(),
          fetchSuspectedSubscriptions(),
          fetchAiSpendingAnalysis(),
        ]);

      setUnified(unifiedResult);
      setAccounts(accountsResult);
      setSubscriptions(subscriptionsResult);
      setAnalysis(analysisResult);

      if (accountsResult.length > 0) {
        setSelectedAccountId((prev) => prev || accountsResult[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load statements.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadAccountStatement = useCallback(
    async (accountId: string, filters: AccountFilters) => {
      setStatementLoading(true);
      setStatementError(null);
      try {
        const result = await fetchAccountStatement({
          accountId,
          filters: toQueryFilters(filters),
        });
        setAccountStatement(result);
      } catch (loadError) {
        setStatementError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load account statement.",
        );
      } finally {
        setStatementLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedAccountId) {
      setAccountStatement(null);
      return;
    }
    void loadAccountStatement(selectedAccountId, accountFilters);
  }, [selectedAccountId, accountFilters, loadAccountStatement]);

  const potentialSavings = useMemo(() => {
    const fromAi =
      analysis?.analysis.subscription_advice.unused_subscriptions.reduce(
        (sum, item) => sum + item.monthly_cost,
        0,
      ) || 0;
    if (fromAi > 0) return fromAi;
    return subscriptions.reduce(
      (sum, item) => sum + item.estimated_monthly_cost,
      0,
    );
  }, [analysis, subscriptions]);

  const aiInsightHeadline = useMemo(() => {
    const count = subscriptions.length;
    const totalMonthly = subscriptions.reduce(
      (sum, item) => sum + item.estimated_monthly_cost,
      0,
    );
    return `You are paying for ${count} subscriptions totaling ${fmt(totalMonthly)}/month.`;
  }, [subscriptions]);

  const aiRecommendation = useMemo(() => {
    const best = analysis?.analysis.subscription_advice.cancellation_suggestions[0];
    if (!best) return null;
    return `${best.subscription}: ${best.recommendation} (${best.reason})`;
  }, [analysis]);

  const onAccountFilterChange = <K extends keyof AccountFilters>(
    key: K,
    value: AccountFilters[K],
  ) => {
    setAccountFilters((prev) => ({
      ...prev,
      [key]: value,
      page: key === "page" ? value as number : 1,
    }));
  };

  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Statements</p>
        <h1 className="aw-page-title">Statements</h1>
        <p className="aw-page-subtitle">
          Unified spend visibility across linked cards and bank accounts.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-[var(--aw-danger)]/30 bg-[var(--aw-danger)]/10 px-3 py-2 text-sm text-[var(--aw-danger)]">
          {error}
        </div>
      ) : null}

      <section className="aw-surface p-4 md:p-5">
        <p className="aw-kicker">Unified Spend Summary</p>
        {isLoading ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--aw-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Loading summary...
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
              <p className="text-xs text-[var(--aw-text-muted)]">Total Monthly Spend</p>
              <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                {fmt(unified?.total_spend_month || 0)}
              </p>
            </article>
            <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
              <p className="text-xs text-[var(--aw-text-muted)]">Active Subscriptions</p>
              <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                {subscriptions.length}
              </p>
            </article>
            <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
              <p className="text-xs text-[var(--aw-text-muted)]">Potential Savings</p>
              <p className="mt-1 text-xl font-semibold text-[var(--aw-text)]">
                {fmt(potentialSavings)}
              </p>
            </article>
          </div>
        )}
      </section>

      <section className="mt-5 aw-surface p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="aw-kicker">Accounts</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              Account Cards
            </h2>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {accounts.map((account) => {
            const isActive = selectedAccountId === account.id;
            return (
              <button
                type="button"
                key={account.id}
                onClick={() => {
                  setSelectedAccountId(account.id);
                  setAccountFilters((prev) => ({ ...prev, page: 1 }));
                }}
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  isActive
                    ? "border-[var(--aw-primary-strong)] bg-[var(--aw-primary-soft)]"
                    : "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] hover:border-[var(--aw-border-strong)]"
                }`}
              >
                <p className="text-sm font-semibold text-[var(--aw-text)]">
                  {accountLabel(account)}
                </p>
                <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                  {titleCase(account.account_type)} • {account.institution_name}
                </p>
              </button>
            );
          })}
          {accounts.length === 0 ? (
            <p className="text-sm text-[var(--aw-text-muted)]">
              No linked accounts found yet.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-5 aw-surface p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="aw-kicker">Statement</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              {accountStatement?.account_name || "Account Transactions"}
            </h2>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            type="date"
            className="aw-input h-10 text-sm"
            value={accountFilters.date_from}
            onChange={(event) => onAccountFilterChange("date_from", event.target.value)}
          />
          <input
            type="date"
            className="aw-input h-10 text-sm"
            value={accountFilters.date_to}
            onChange={(event) => onAccountFilterChange("date_to", event.target.value)}
          />
          <input
            type="text"
            className="aw-input h-10 text-sm"
            value={accountFilters.merchant}
            placeholder="Merchant"
            onChange={(event) => onAccountFilterChange("merchant", event.target.value)}
          />
          <input
            type="text"
            className="aw-input h-10 text-sm"
            value={accountFilters.category}
            placeholder="Category"
            onChange={(event) => onAccountFilterChange("category", event.target.value)}
          />
          <select
            className="aw-input h-10 text-sm"
            value={accountFilters.pending}
            onChange={(event) =>
              onAccountFilterChange("pending", event.target.value as AccountFilters["pending"])
            }
          >
            <option value="">All statuses</option>
            <option value="false">Posted</option>
            <option value="true">Pending</option>
          </select>
        </div>

        {statementError ? (
          <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--aw-danger)]/30 bg-[var(--aw-danger)]/10 px-3 py-2 text-xs text-[var(--aw-danger)]">
            <AlertCircle size={12} />
            {statementError}
          </p>
        ) : null}

        {statementLoading ? (
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--aw-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Loading transactions...
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr_0.6fr_0.8fr] gap-2 px-2 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
              <span>Merchant</span>
              <span className="text-right">Amount</span>
              <span>Date</span>
              <span>Status</span>
              <span>Category</span>
            </div>
            <div className="aw-scroll max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {(accountStatement?.transactions || []).map((tx) => (
                <article
                  key={tx.id}
                  className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5"
                >
                  <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr_0.6fr_0.8fr] gap-2 text-sm">
                    <span className="truncate text-[var(--aw-text)]">{tx.merchant_name}</span>
                    <span className="text-right font-semibold text-[var(--aw-text)]">
                      {fmt(Math.abs(tx.amount))}
                    </span>
                    <span className="text-[var(--aw-text-soft)]">{fmtDate(tx.occurred_at)}</span>
                    <span
                      className={`uppercase text-[11px] ${
                        tx.pending ? "text-[var(--aw-warning)]" : "text-[var(--aw-success)]"
                      }`}
                    >
                      {tx.pending ? "pending" : "posted"}
                    </span>
                    <span className="truncate text-[var(--aw-text-soft)]">
                      {titleCase(tx.category)}
                    </span>
                  </div>
                </article>
              ))}
              {(accountStatement?.transactions.length || 0) === 0 ? (
                <p className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-5 text-center text-sm text-[var(--aw-text-muted)]">
                  No transactions for this account with current filters.
                </p>
              ) : null}
            </div>

            {accountStatement?.pagination ? (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--aw-text-muted)]">
                  Page {accountStatement.pagination.page} of{" "}
                  {accountStatement.pagination.total_pages} •{" "}
                  {accountStatement.pagination.total} transactions
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="aw-button-secondary h-8 px-3 text-xs"
                    disabled={accountStatement.pagination.page <= 1}
                    onClick={() =>
                      onAccountFilterChange(
                        "page",
                        Math.max(1, accountFilters.page - 1),
                      )
                    }
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="aw-button-secondary h-8 px-3 text-xs"
                    disabled={!accountStatement.pagination.has_next}
                    onClick={() =>
                      onAccountFilterChange("page", accountFilters.page + 1)
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="mt-5 aw-surface p-4 md:p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--aw-primary-strong)]" />
          <div>
            <p className="aw-kicker">AI Insights</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
              AI Insights
            </h2>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-3">
          <p className="text-sm text-[var(--aw-text)]">{aiInsightHeadline}</p>
          {aiRecommendation ? (
            <p className="mt-2 text-xs text-[var(--aw-text-soft)]">
              Recommendation: {aiRecommendation}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--aw-text-soft)]">
              No cancellation actions are executed here; this panel only provides guidance.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
