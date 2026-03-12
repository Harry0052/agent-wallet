export type AllowedCategory = "digital_products" | "SaaS" | "API credits";

export interface SpendingPolicyConfig {
  maxTransaction: number;
  allowedCategories: AllowedCategory[];
}

export interface PurchaseCandidate {
  serviceName: string;
  merchant: string;
  category: AllowedCategory;
  amount: number;
  currency: "USD";
  checkoutUrl: string;
  sourceUrl: string;
}

export class SpendingPolicy {
  private readonly maxTransaction: number;
  private readonly allowedCategories: Set<AllowedCategory>;

  constructor(config?: Partial<SpendingPolicyConfig>) {
    this.maxTransaction = config?.maxTransaction ?? 5;
    this.allowedCategories = new Set(
      config?.allowedCategories ?? ["digital_products", "SaaS", "API credits"],
    );
  }

  getMaxTransaction(): number {
    return this.maxTransaction;
  }

  getAllowedCategories(): AllowedCategory[] {
    return [...this.allowedCategories];
  }

  assertAllowed(candidate: PurchaseCandidate): void {
    if (!this.allowedCategories.has(candidate.category)) {
      throw new Error(
        `Blocked by category policy: "${candidate.category}" is not allowed.`,
      );
    }

    if (candidate.amount > this.maxTransaction) {
      throw new Error(
        `Blocked by spending policy: $${candidate.amount.toFixed(
          2,
        )} exceeds $${this.maxTransaction.toFixed(2)}.`,
      );
    }
  }
}
