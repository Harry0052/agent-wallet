import { NextRequest, NextResponse } from "next/server";
import { isAuthError } from "@/lib/server/auth";
import {
  apiError,
  classifyTaskError,
  logServerEvent,
} from "@/lib/server/observability";
import { parseStatementQueryParams } from "@/statements/statementService";
import { getUnifiedStatement } from "@/statements/unifiedStatement";
import { buildMoneyIntelligenceForUser } from "@/lib/server/moneyIntelligence/engine";
import { getAutomationSummaryForUser } from "@/lib/server/automation/service";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "statements" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const userId = auth.auth.walletUserId;
    const parsed = parseStatementQueryParams(req.nextUrl.searchParams);
    const [statement, moneyIntelligence, automationSummary] = await Promise.all([
      getUnifiedStatement({
        userId,
        filters: parsed.filters,
        pagination: parsed.pagination,
      }),
      buildMoneyIntelligenceForUser(userId).catch((error) => {
        const message = error instanceof Error ? error.message : "unknown";
        logServerEvent("warn", "statements.unified.money_intelligence.unavailable", {
          userId,
          message,
        });
        return null;
      }),
      getAutomationSummaryForUser({ userId }).catch((error) => {
        const message = error instanceof Error ? error.message : "unknown";
        logServerEvent("warn", "statements.unified.automation_summary.unavailable", {
          userId,
          message,
        });
        return null;
      }),
    ]);
    const moneyStatement = moneyIntelligence
      ? (({ classifiedTransactions, ...rest }) => {
          void classifiedTransactions;
          return rest;
        })(moneyIntelligence.statement)
      : null;

    return NextResponse.json({
      ok: true,
      statement: {
        ...statement,
        money_intelligence: moneyIntelligence
          ? {
              generatedAt: moneyIntelligence.generatedAt,
              engineVersion: moneyIntelligence.engineVersion,
              rulesVersion: moneyIntelligence.rulesVersion,
              statement: moneyStatement,
              coverage: moneyIntelligence.coverage,
              netWorth: moneyIntelligence.netWorth,
              spendingLimits: moneyIntelligence.spendingLimits,
              affordability: moneyIntelligence.affordability,
              weeklyPrediction: moneyIntelligence.weeklyPrediction,
              monthlySurvivalForecast: moneyIntelligence.monthlySurvivalForecast,
              billPredictions: moneyIntelligence.billPredictions,
              subscriptionTimeline: moneyIntelligence.subscriptionTimeline,
              alerts: moneyIntelligence.alerts,
              categoryLearning: moneyIntelligence.categoryLearning,
              studentFocus: moneyIntelligence.studentFocus,
              advancedIntelligence: moneyIntelligence.advancedIntelligence,
            }
          : null,
        automation: automationSummary
          ? {
              summary: automationSummary.summary,
              policy: {
                defaultMode: automationSummary.policy.defaultMode,
              },
            }
          : null,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }

    const message =
      error instanceof Error ? error.message : "Failed to load unified statement.";
    const status = message.toLowerCase().includes("invalid ") ? 400 : 500;
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "statements.unified.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status });
  }
}
