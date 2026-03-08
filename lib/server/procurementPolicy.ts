import type { ProcurementFinding, Wallet } from '@/lib/types';
import { getWallet } from '@/lib/server/ledger';

type PolicyCheckKey =
  | 'available_balance'
  | 'max_transaction_limit'
  | 'daily_spend_limit'
  | 'approved_vendor_or_domain'
  | 'blocked_vendor_or_domain'
  | 'approval_threshold';

export interface SpendPolicyCheck {
  key: PolicyCheckKey;
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface SpendPolicyResult {
  allowed: boolean;
  approvalRequired: boolean;
  amountEvaluated: number | null;
  amountBasis: 'monthly' | 'annual' | 'unknown';
  currency: 'USD';
  checks: SpendPolicyCheck[];
  reason?: string;
  evaluatedAt: string;
}

function startOfDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function sumSucceededDebitsSince(wallet: Wallet, sinceMs: number): number {
  return wallet.transactions.reduce((acc, tx) => {
    if (tx.status !== 'succeeded' || tx.direction !== 'debit') return acc;
    const createdAt = Date.parse(tx.createdAt);
    if (Number.isNaN(createdAt) || createdAt < sinceMs) return acc;
    return acc + tx.amount;
  }, 0);
}

function sourceDomain(sourceUrl: string): string | null {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizeList(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function matchesAny(targets: string[], list: string[]): boolean {
  const normalizedTargets = targets.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const normalizedList = normalizeList(list);
  if (normalizedTargets.length === 0 || normalizedList.length === 0) return false;

  return normalizedList.some((entry) => (
    normalizedTargets.some((target) => target.includes(entry) || entry.includes(target))
  ));
}

function derivePolicyAmount(finding: ProcurementFinding): {
  amount: number | null;
  basis: 'monthly' | 'annual' | 'unknown';
} {
  const frequency = finding.billingFrequency.toLowerCase();

  if (frequency.includes('year') || frequency.includes('annual')) {
    if (finding.annualPrice !== null) {
      return {
        amount: finding.annualPrice,
        basis: 'annual',
      };
    }

    return {
      amount: null,
      basis: 'unknown',
    };
  }

  if (frequency.includes('month') || finding.monthlyPrice !== null) {
    return {
      amount: finding.monthlyPrice,
      basis: finding.monthlyPrice !== null ? 'monthly' : 'unknown',
    };
  }

  if (finding.annualPrice !== null) {
    return {
      amount: finding.annualPrice,
      basis: 'annual',
    };
  }

  return {
    amount: null,
    basis: 'unknown',
  };
}

export async function evaluateSpendPolicy(params: {
  userId: string;
  finding: ProcurementFinding;
}): Promise<SpendPolicyResult> {
  const wallet = await getWallet(params.userId);
  const nowIso = new Date().toISOString();
  const amountInfo = derivePolicyAmount(params.finding);
  const amount = amountInfo.amount;
  const dailySpent = Math.round(sumSucceededDebitsSince(wallet, startOfDayMs()) * 100) / 100;
  const domain = sourceDomain(params.finding.pricingPageUrl);
  const targets = [params.finding.vendorName, domain || ''].filter(Boolean);

  const checks: SpendPolicyCheck[] = [];

  if (amount === null) {
    checks.push({
      key: 'available_balance',
      label: 'Available wallet balance',
      passed: false,
      blocking: true,
      detail: 'Cannot verify balance impact because the plan price could not be normalized from live findings.',
    });
  } else {
    checks.push({
      key: 'available_balance',
      label: 'Available wallet balance',
      passed: amount <= wallet.balance,
      blocking: true,
      detail: amount <= wallet.balance
        ? `Wallet balance ${wallet.currency} ${wallet.balance.toFixed(2)} covers ${amount.toFixed(2)}.`
        : `Wallet balance ${wallet.currency} ${wallet.balance.toFixed(2)} is below ${amount.toFixed(2)}.`,
    });
  }

  if (amount === null) {
    checks.push({
      key: 'max_transaction_limit',
      label: 'Max transaction limit',
      passed: false,
      blocking: true,
      detail: 'Cannot evaluate max transaction limit without a normalized charge amount.',
    });
  } else {
    checks.push({
      key: 'max_transaction_limit',
      label: 'Max transaction limit',
      passed: amount <= wallet.settings.maxTransaction,
      blocking: true,
      detail: amount <= wallet.settings.maxTransaction
        ? `Charge ${amount.toFixed(2)} is within max transaction ${wallet.settings.maxTransaction.toFixed(2)}.`
        : `Charge ${amount.toFixed(2)} exceeds max transaction ${wallet.settings.maxTransaction.toFixed(2)}.`,
    });
  }

  if (amount === null) {
    checks.push({
      key: 'daily_spend_limit',
      label: 'Daily spend limit',
      passed: false,
      blocking: true,
      detail: 'Cannot evaluate daily spend impact without a normalized charge amount.',
    });
  } else {
    const projected = dailySpent + amount;
    checks.push({
      key: 'daily_spend_limit',
      label: 'Daily spend limit',
      passed: projected <= wallet.settings.dailyLimit,
      blocking: true,
      detail: projected <= wallet.settings.dailyLimit
        ? `Projected daily spend ${projected.toFixed(2)} is within ${wallet.settings.dailyLimit.toFixed(2)}.`
        : `Projected daily spend ${projected.toFixed(2)} exceeds ${wallet.settings.dailyLimit.toFixed(2)}.`,
    });
  }

  const allowedList = wallet.settings.allowedMerchants;
  if (allowedList.length === 0) {
    checks.push({
      key: 'approved_vendor_or_domain',
      label: 'Approved vendor/domain list',
      passed: true,
      blocking: true,
      detail: 'No approved list configured; all vendors are eligible unless blocked.',
    });
  } else {
    const approved = matchesAny(targets, allowedList);
    checks.push({
      key: 'approved_vendor_or_domain',
      label: 'Approved vendor/domain list',
      passed: approved,
      blocking: true,
      detail: approved
        ? `Matched approved entries for ${params.finding.vendorName}${domain ? ` (${domain})` : ''}.`
        : `No approved entry matched ${params.finding.vendorName}${domain ? ` or ${domain}` : ''}.`,
    });
  }

  const blocked = matchesAny(targets, wallet.settings.blockedMerchants);
  checks.push({
    key: 'blocked_vendor_or_domain',
    label: 'Blocked vendor/domain list',
    passed: !blocked,
    blocking: true,
    detail: blocked
      ? `Blocked entry matched ${params.finding.vendorName}${domain ? ` or ${domain}` : ''}.`
      : `No blocked entry matched ${params.finding.vendorName}${domain ? ` or ${domain}` : ''}.`,
  });

  const approvalRequired = amount === null || amount >= wallet.settings.approvalThreshold;
  checks.push({
    key: 'approval_threshold',
    label: 'Approval threshold',
    passed: !approvalRequired,
    blocking: false,
    detail: amount === null
      ? 'Amount is unknown; manual approval is required.'
      : approvalRequired
        ? `Charge ${amount.toFixed(2)} meets/exceeds approval threshold ${wallet.settings.approvalThreshold.toFixed(2)}.`
        : `Charge ${amount.toFixed(2)} is below approval threshold ${wallet.settings.approvalThreshold.toFixed(2)}.`,
  });

  const blockingFailures = checks.filter((check) => check.blocking && !check.passed);
  const allowed = blockingFailures.length === 0;

  return {
    allowed,
    approvalRequired,
    amountEvaluated: amount,
    amountBasis: amountInfo.basis,
    currency: 'USD',
    checks,
    reason: blockingFailures[0]?.detail,
    evaluatedAt: nowIso,
  };
}
