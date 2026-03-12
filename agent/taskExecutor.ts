import { Ledger } from "@/ledger/ledger";
import { SpendingPolicy } from "@/guardrails/spendingPolicy";
import { WebNavigator } from "@/tools/webNavigator";
import { CheckoutAgent } from "@/tools/checkoutAgent";

interface TaskExecutorDeps {
  policy?: SpendingPolicy;
  webNavigator?: WebNavigator;
  checkoutAgent?: CheckoutAgent;
  ledger?: Ledger;
}

interface ExecuteTaskInput {
  walletId: string;
  finalConfirmation?: () => Promise<boolean>;
}

interface TaskExecutionResult {
  serviceName: string;
  amount: number;
  merchant: string;
  transactionId: string;
  report: string;
}

export class TaskExecutor {
  private readonly policy: SpendingPolicy;
  private readonly webNavigator: WebNavigator;
  private readonly checkoutAgent: CheckoutAgent;
  private readonly ledger: Ledger;

  constructor(deps?: TaskExecutorDeps) {
    this.policy = deps?.policy ?? new SpendingPolicy({ maxTransaction: 5 });
    this.webNavigator = deps?.webNavigator ?? new WebNavigator();
    this.checkoutAgent = deps?.checkoutAgent ?? new CheckoutAgent();
    this.ledger = deps?.ledger ?? new Ledger();
  }

  async executeSmallPaidTask(
    input: ExecuteTaskInput,
  ): Promise<TaskExecutionResult> {
    const options = await this.webNavigator.findAffordableCandidates(this.policy);
    if (options.length === 0) {
      throw new Error(
        "No eligible digital service/product under $5 was discovered.",
      );
    }

    const selected = options[0];
    this.policy.assertAllowed(selected);

    const confirmed = await (input.finalConfirmation?.() ?? Promise.resolve(true));
    if (!confirmed) {
      throw new Error("Final confirmation rejected. Purchase aborted.");
    }

    const checkoutSession = await this.checkoutAgent.initiateCheckout(selected);
    const completedSession =
      await this.checkoutAgent.completeCheckout(checkoutSession);

    if (completedSession.status !== "completed") {
      throw new Error("Checkout could not be completed.");
    }

    await this.ledger.logTransaction({
      transaction_id: completedSession.sessionId,
      wallet_id: input.walletId,
      amount: completedSession.amount,
      merchant: completedSession.merchant,
      timestamp: completedSession.completedAt ?? new Date().toISOString(),
      status: "completed",
    });

    const report = [
      "Task completed.",
      "",
      `Service purchased: ${selected.serviceName}`,
      `Price: $${selected.amount.toFixed(2)}`,
      `Merchant: ${selected.merchant}`,
      `Transaction ID: ${completedSession.sessionId}`,
    ].join("\n");

    return {
      serviceName: selected.serviceName,
      amount: selected.amount,
      merchant: selected.merchant,
      transactionId: completedSession.sessionId,
      report,
    };
  }
}
