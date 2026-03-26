'use client';

import { invalidateDomain } from './cache';

/** Call after Plaid sync completes (webhook or manual) */
export function onTransactionSyncComplete(): void {
  invalidateDomain('transactions');
  invalidateDomain('dashboard');
  invalidateDomain('statements');
  invalidateDomain('subscriptions');
}

/** Call after category correction */
export function onCategoryCorrected(): void {
  invalidateDomain('transactions');
  invalidateDomain('statements');
  invalidateDomain('dashboard');
}

/** Call after budget updated */
export function onBudgetUpdated(): void {
  invalidateDomain('budgets');
  invalidateDomain('dashboard');
}

/** Call after account connected/removed */
export function onAccountChanged(): void {
  invalidateDomain('accounts');
  invalidateDomain('transactions');
  invalidateDomain('dashboard');
  invalidateDomain('statements');
  invalidateDomain('balances');
}

/** Call after balance refresh */
export function onBalanceRefreshed(): void {
  invalidateDomain('balances');
  invalidateDomain('accounts');
  invalidateDomain('dashboard');
}

/** Call after statement ingestion */
export function onStatementIngested(): void {
  invalidateDomain('statements');
  invalidateDomain('transactions');
  invalidateDomain('dashboard');
}

/** Call after settings change */
export function onSettingsChanged(): void {
  invalidateDomain('settings');
  invalidateDomain('wallet');
}
