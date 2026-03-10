"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, History, Settings2, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import type { SavedPaymentMethod, UserToolRecord } from "@/lib/types";
import { fmt } from "@/lib/utils";
import { getDailySpent, getMonthlySpent } from "@/services/wallet";
import * as fundingService from "@/services/funding";
import { fetchUserTools } from "@/services/tools";
import { StripeSetupForm } from "@/components/StripeSetupForm";

function methodLabel(method: SavedPaymentMethod): string {
  const brand = method.brand ? `${method.brand.charAt(0).toUpperCase()}${method.brand.slice(1)}` : "Card";
  const last4 = method.last4 ? `**** ${method.last4}` : "saved method";
  return `${brand} ${last4}`;
}

function methodExpiry(method: SavedPaymentMethod): string {
  if (!method.expMonth || !method.expYear) return "Expiry not available";
  return `Exp ${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`;
}

type StripeStatus = "Connected" | "Not connected" | "Disabled" | "Needs reconnect";

function hasConnectionSignal(tool: UserToolRecord): boolean {
  return (
    tool.hasSecret
    || Boolean(tool.loginIdentifierMasked)
    || tool.status === "connected"
    || tool.status === "failed"
  );
}

function stripeStatus(tool: UserToolRecord | null): StripeStatus {
  if (!tool) return "Not connected";
  if (tool.status === "failed") return "Needs reconnect";
  if (tool.status === "connected") return tool.enabled ? "Connected" : "Disabled";
  if (!tool.enabled) return hasConnectionSignal(tool) ? "Disabled" : "Not connected";
  if (tool.status === "disconnected" || tool.status === "pending") {
    return hasConnectionSignal(tool) ? "Needs reconnect" : "Not connected";
  }
  return "Not connected";
}

export function WalletCard() {
  const { wallet, startFunding, toggleSettings, toggleHistory } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [amount, setAmount] = useState("");
  const [forgetAfterUse, setForgetAfterUse] = useState(false);
  const [savedMethods, setSavedMethods] = useState<SavedPaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [setupPublishableKey, setSetupPublishableKey] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [methodMessage, setMethodMessage] = useState<string | null>(null);
  const [stripeTool, setStripeTool] = useState<UserToolRecord | null>(null);

  const dailySpent = getDailySpent(wallet);
  const monthlySpent = getMonthlySpent(wallet);
  const usagePct =
    wallet.settings.monthlyBudget > 0
      ? Math.min((monthlySpent / wallet.settings.monthlyBudget) * 100, 100)
      : 0;

  const loadSavedMethods = useCallback(async () => {
    setMethodsLoading(true);
    setMethodsError(null);
    try {
      const methods = await fundingService.listSavedPaymentMethods();
      setSavedMethods(methods);
    } catch (error) {
      setMethodsError(error instanceof Error ? error.message : "Could not load saved payment methods.");
    } finally {
      setMethodsLoading(false);
    }
  }, []);

  const loadStripeTool = useCallback(async () => {
    try {
      const tools = await fetchUserTools();
      const stripe = tools.find((tool) => tool.tool.key === "stripe") || null;
      setStripeTool(stripe);
    } catch {
      setStripeTool(null);
    }
  }, []);

  useEffect(() => {
    void loadSavedMethods();
  }, [loadSavedMethods]);

  useEffect(() => {
    void loadStripeTool();
  }, [loadStripeTool]);

  const openSetupFlow = useCallback(async (consentSource: string) => {
    setSetupLoading(true);
    setMethodMessage(null);
    try {
      const setup = await fundingService.createFundingSetupIntent({
        consentSource,
        consentVersion: "v1",
      });
      setSetupClientSecret(setup.clientSecret);
      setSetupPublishableKey(setup.publishableKey);
      setShowSetupForm(true);
    } catch (error) {
      setMethodMessage(error instanceof Error ? error.message : "Could not start payment method setup.");
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupStatus = params.get("funding_setup");
    const setupIntentId = params.get("setup_intent");
    const shouldOpenSetup = params.get("open_payment_setup") === "1";
    const setupSource = params.get("source") === "tools" ? "tools_page" : "wallet_page";
    let shouldCleanUrl = false;

    if (setupStatus === "return" && setupIntentId) {
      shouldCleanUrl = true;
      setMethodMessage(null);
      void (async () => {
        try {
          await fundingService.confirmFundingSetupIntent(setupIntentId);
          setMethodMessage("Payment method saved. You can now approve top-ups in chat.");
          await loadSavedMethods();
          await loadStripeTool();
        } catch (error) {
          setMethodMessage(error instanceof Error ? error.message : "Payment setup was not completed.");
        }
      })();
    } else if (setupStatus === "success") {
      shouldCleanUrl = true;
      setMethodMessage("Payment method saved. You can now approve top-ups without entering card details again.");
      void loadSavedMethods();
      void loadStripeTool();
    } else if (setupStatus === "cancelled") {
      shouldCleanUrl = true;
      setMethodMessage("Payment method setup was cancelled.");
    }

    if (shouldOpenSetup) {
      shouldCleanUrl = true;
      void openSetupFlow(setupSource);
    }

    if (shouldCleanUrl) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadSavedMethods, loadStripeTool, openSetupFlow]);

  const handleAdd = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) return;

    const preferred = savedMethods[0];
    await startFunding(
      value,
      preferred
        ? {
          paymentMethodId: preferred.stripePaymentMethodId,
          forgetAfterUse,
        }
        : undefined,
    );

    setAmount("");
    setForgetAfterUse(false);
    setShowAdd(false);
  };

  const handleSetupPaymentMethod = async () => {
    await openSetupFlow("wallet_page");
  };

  const currentStripeStatus = stripeStatus(stripeTool);

  const handleRemovePaymentMethod = async (paymentMethodId: string) => {
    setRemovingId(paymentMethodId);
    setMethodMessage(null);
    try {
      await fundingService.removeSavedPaymentMethod(paymentMethodId);
      setMethodMessage("Saved payment method removed.");
      await loadSavedMethods();
      await loadStripeTool();
    } catch (error) {
      setMethodMessage(error instanceof Error ? error.message : "Could not remove this payment method.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="aw-surface p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="aw-kicker">Wallet Overview</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--aw-text)]">
            {fmt(wallet.balance)}
          </p>
        </div>
        <span
          className="aw-status-chip"
          data-state={wallet.balance > 0 ? "ok" : "alert"}
        >
          {wallet.balance > 0 ? "Ready To Spend" : "Needs Funding"}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--aw-text-soft)]">
          <span>Monthly spend</span>
          <span>
            {fmt(monthlySpent)} / {fmt(wallet.settings.monthlyBudget)}
          </span>
        </div>
        <div className="aw-progress">
          <span style={{ width: `${usagePct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5">
          <p className="text-[var(--aw-text-muted)]">Max transaction</p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">
            {fmt(wallet.settings.maxTransaction)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-2.5">
          <p className="text-[var(--aw-text-muted)]">Daily limit</p>
          <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">
            {fmt(dailySpent)} / {fmt(wallet.settings.dailyLimit)}
          </p>
        </div>
      </div>

      <section className="space-y-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--aw-text)]">Saved payment methods</p>
            <p className="text-[11px] text-[var(--aw-text-muted)]">Only Stripe references are stored in Agent Wallet.</p>
          </div>
          <button
            onClick={() => void handleSetupPaymentMethod()}
            disabled={setupLoading}
            className="aw-button-secondary h-8 px-3 text-[11px]"
          >
            {setupLoading ? "Loading..." : "Set up payment method"}
          </button>
        </div>

        {showSetupForm && setupClientSecret && setupPublishableKey ? (
          <div className="rounded-lg border border-[var(--aw-border)] bg-white px-3 py-3">
            <p className="text-xs font-medium text-[var(--aw-text)]">Set up payment method</p>
            <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
              Save a card once and approve future top-ups from chat.
            </p>
            <div className="mt-3">
              <StripeSetupForm
                clientSecret={setupClientSecret}
                publishableKey={setupPublishableKey}
                onSaved={(method) => {
                  setShowSetupForm(false);
                  setSetupClientSecret(null);
                  setSetupPublishableKey(null);
                  setMethodMessage(`Saved payment method: ${methodLabel(method)}.`);
                  void loadSavedMethods();
                  void loadStripeTool();
                }}
                onCancel={() => {
                  setShowSetupForm(false);
                  setSetupClientSecret(null);
                  setSetupPublishableKey(null);
                }}
              />
            </div>
          </div>
        ) : null}

        {currentStripeStatus !== "Connected" ? (
          <div className="rounded-lg border border-[var(--aw-border)] bg-white px-3 py-2.5">
            <p className="text-xs font-medium text-[var(--aw-text)]">
              {currentStripeStatus === "Needs reconnect" ? "Reconnect Stripe" : "Set up Stripe"}
            </p>
            <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
              Connect Stripe to fund your wallet and manage payments.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {currentStripeStatus === "Disabled" ? (
                <Link href="/tools" className="aw-button-primary h-8 px-3 text-[11px]">
                  Enable in Tools
                </Link>
              ) : (
                <button
                  onClick={() => void handleSetupPaymentMethod()}
                  disabled={setupLoading}
                  className="aw-button-primary h-8 px-3 text-[11px]"
                >
                  {setupLoading ? "Loading..." : currentStripeStatus === "Needs reconnect" ? "Reconnect" : "Connect"}
                </button>
              )}
              <Link href="/tools" className="aw-button-secondary h-8 px-3 text-[11px]">
                Open Tools
              </Link>
            </div>
          </div>
        ) : null}

        {methodsLoading ? (
          <p className="text-xs text-[var(--aw-text-muted)]">Loading saved methods...</p>
        ) : methodsError ? (
          <p className="text-xs text-[var(--aw-danger)]">{methodsError}</p>
        ) : savedMethods.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--aw-border)] bg-[var(--aw-surface)] px-3 py-2.5">
            <p className="text-xs text-[var(--aw-text-muted)]">No saved payment methods yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {savedMethods.map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--aw-border)] bg-[var(--aw-surface)] px-3 py-2.5"
              >
                <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[var(--aw-text)]">
                      {methodLabel(method)}
                    {method.isDefault ? " - Default" : ""}
                  </p>
                  <p className="text-[11px] text-[var(--aw-text-muted)]">{methodExpiry(method)}</p>
                </div>
                <button
                  onClick={() => void handleRemovePaymentMethod(method.stripePaymentMethodId)}
                  disabled={removingId === method.stripePaymentMethodId}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--aw-border)] px-2 text-[11px] text-[var(--aw-text-soft)] hover:bg-[var(--aw-surface-subtle)]"
                >
                  <Trash2 size={12} />
                  {removingId === method.stripePaymentMethodId ? "Removing" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}

        {methodMessage ? <p className="text-[11px] text-[var(--aw-text-soft)]">{methodMessage}</p> : null}
      </section>

      {showAdd ? (
        <div className="space-y-2">
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
            placeholder="Top-up amount"
            className="aw-input h-10 text-sm"
            autoFocus
          />
          {savedMethods[0] ? (
            <div className="space-y-1">
              <p className="text-xs text-[var(--aw-text-muted)]">
                Approve from {methodLabel(savedMethods[0])}
              </p>
              <label className="flex items-center gap-2 text-xs text-[var(--aw-text-soft)]">
                <input
                  type="checkbox"
                  checked={forgetAfterUse}
                  onChange={(event) => setForgetAfterUse(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--aw-primary)]"
                />
                Forget this payment method after this top-up
              </label>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void handleAdd()}
              className="aw-button-primary h-10 text-sm"
            >
              {savedMethods[0] ? "Approve Top-Up" : "Continue"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setForgetAfterUse(false);
              }}
              className="aw-button-secondary h-10 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="aw-button-ghost h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <CreditCard size={12} />
              Add Funds
            </span>
          </button>
          <button
            onClick={toggleHistory}
            className="aw-button-secondary h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <History size={12} />
              Ledger
            </span>
          </button>
          <button
            onClick={toggleSettings}
            className="aw-button-secondary h-10 text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <Settings2 size={12} />
              Guardrails
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
