import { PurchaseCandidate } from "@/guardrails/spendingPolicy";

export interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
  merchant: string;
  amount: number;
  status: "initiated" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
}

export class CheckoutAgent {
  async initiateCheckout(candidate: PurchaseCandidate): Promise<CheckoutSession> {
    const reachable = await this.checkReachability(candidate.checkoutUrl);
    if (!reachable) {
      throw new Error(`Checkout URL is not reachable: ${candidate.checkoutUrl}`);
    }

    return {
      sessionId: this.createSessionId(),
      checkoutUrl: candidate.checkoutUrl,
      merchant: candidate.merchant,
      amount: candidate.amount,
      status: "initiated",
      startedAt: new Date().toISOString(),
    };
  }

  async completeCheckout(session: CheckoutSession): Promise<CheckoutSession> {
    if (session.status !== "initiated") {
      return {
        ...session,
        status: "failed",
      };
    }

    return {
      ...session,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
  }

  private async checkReachability(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
      });
      return response.ok || (response.status >= 300 && response.status < 400);
    } catch {
      return false;
    }
  }

  private createSessionId(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `txn_${Date.now()}_${random}`;
  }
}
