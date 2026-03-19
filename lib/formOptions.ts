import { readLocalStorageJson, MANUAL_STORAGE_KEYS } from "@/lib/manualMode";
import type { StatementTransaction } from "@/services/statements";

// ── Default category sets ────────────────────────────────────────────────────

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Groceries",
  "Dining",
  "Rent",
  "Mortgage",
  "Utilities",
  "Insurance",
  "Transportation",
  "Gas",
  "Shopping",
  "Entertainment",
  "Travel",
  "Healthcare",
  "Personal care",
  "Education",
  "Subscriptions",
  "Debt payment",
  "Gifts",
  "Donations",
  "Clothing",
  "Home improvement",
  "Pet care",
  "Childcare",
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  "Paycheck",
  "Bonus",
  "Interest",
  "Freelance",
  "Dividends",
  "Rental income",
  "Side hustle",
  "Refund",
  "Other income",
] as const;

export const ALL_DEFAULT_CATEGORIES = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
] as const;

// ── Dynamic options from user data ───────────────────────────────────────────

/**
 * Build a deduplicated, sorted list of categories from both default values
 * and the user's existing transaction data.
 */
export function buildCategoryOptions(
  connectedTransactions?: StatementTransaction[],
  transactionType?: "income" | "expense" | "all",
): string[] {
  const defaults =
    transactionType === "income"
      ? [...DEFAULT_INCOME_CATEGORIES]
      : transactionType === "expense"
        ? [...DEFAULT_EXPENSE_CATEGORIES]
        : [...ALL_DEFAULT_CATEGORIES];

  const manualTxs = readLocalStorageJson<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );

  const allTxs = [...(connectedTransactions ?? []), ...manualTxs];
  const userCategories = allTxs
    .map((tx) => (tx.category || "").trim())
    .filter((cat) => cat.length > 0 && cat.toLowerCase() !== "manual");

  const set = new Set<string>();
  for (const cat of [...defaults, ...userCategories]) {
    // Normalize for dedup but keep the first-seen casing
    const key = cat.toLowerCase();
    if (!set.has(key)) {
      set.add(key);
    }
  }

  // Return sorted with original casing from defaults first, then user values
  const defaultSet = new Set(defaults.map((d) => d.toLowerCase()));
  const result: string[] = [];
  const userOnly: string[] = [];

  for (const cat of set) {
    const display = defaults.find((d) => d.toLowerCase() === cat)
      ?? [...userCategories].find((u) => u.toLowerCase() === cat)
      ?? cat;
    if (defaultSet.has(cat)) {
      result.push(display);
    } else {
      userOnly.push(display);
    }
  }

  result.sort((a, b) => a.localeCompare(b));
  userOnly.sort((a, b) => a.localeCompare(b));

  return [...result, ...userOnly];
}

/**
 * Build a deduplicated list of merchant/source names from user data.
 */
export function buildMerchantOptions(
  connectedTransactions?: StatementTransaction[],
): string[] {
  const manualTxs = readLocalStorageJson<StatementTransaction[]>(
    MANUAL_STORAGE_KEYS.transactions,
    [],
  );

  const allTxs = [...(connectedTransactions ?? []), ...manualTxs];
  const seen = new Map<string, string>();

  for (const tx of allTxs) {
    const name = (tx.merchant_name || tx.normalized_merchant || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, name);
    }
  }

  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Build a list of institution names from connected + manual accounts.
 */
export function buildInstitutionOptions(): string[] {
  const manualAccounts = readLocalStorageJson<Array<{ institutionName?: string }>>(
    MANUAL_STORAGE_KEYS.accounts,
    [],
  );

  const names = manualAccounts
    .map((a) => (a.institutionName || "").trim())
    .filter((n) => n.length > 0);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
