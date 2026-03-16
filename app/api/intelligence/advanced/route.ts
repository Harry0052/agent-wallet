import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiAuth } from "@/security/authGuard";
import { enforceRateLimit } from "@/security/rateLimiter";
import { apiError, classifyTaskError, logServerEvent } from "@/lib/server/observability";
import { isAuthError } from "@/lib/server/auth";
import {
  buildMoneyIntelligenceFromSources,
  loadMoneyIntelligenceSources,
} from "@/lib/server/moneyIntelligence/engine";
import { simulateCustomFinancialScenario } from "@/lib/server/moneyIntelligence/advanced";
import type { MoneyScenarioAssumptions } from "@/lib/server/moneyIntelligence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scenarioSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(120).optional(),
  spendingChangePct: z.number().min(-0.8).max(1),
  incomeChangePct: z.number().min(-0.8).max(1),
  extraDebtPaydownMonthly: z.number().min(0).max(20000).optional(),
  savingsContributionMonthly: z.number().min(0).max(20000).optional(),
});

async function loadBaseline(userId: string) {
  const nowIso = new Date().toISOString();
  const sources = await loadMoneyIntelligenceSources(userId);
  const money = buildMoneyIntelligenceFromSources({
    sources,
    nowIso,
  });

  return {
    nowIso,
    sources,
    money,
  };
}

export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "advanced_intelligence" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const baseline = await loadBaseline(auth.auth.walletUserId);
    return NextResponse.json({
      ok: true,
      advancedIntelligence: baseline.money.advancedIntelligence,
      generatedAt: baseline.money.generatedAt,
      coverage: baseline.money.coverage,
      affordability: baseline.money.affordability,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }

    const message = error instanceof Error ? error.message : "Failed to load advanced intelligence.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "advanced_intelligence.get.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, { profile: "general", scope: "advanced_intelligence_simulation" });
  if (rateLimited) return rateLimited;

  const auth = await enforceApiAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const parsed = scenarioSchema.parse(await req.json());
    const baseline = await loadBaseline(auth.auth.walletUserId);
    const assumptions: MoneyScenarioAssumptions = {
      id: parsed.id || "custom",
      label: parsed.label || "Custom scenario",
      spendingChangePct: parsed.spendingChangePct,
      incomeChangePct: parsed.incomeChangePct,
      extraDebtPaydownMonthly: parsed.extraDebtPaydownMonthly ?? 0,
      savingsContributionMonthly: parsed.savingsContributionMonthly ?? 0,
    };

    const scenario = simulateCustomFinancialScenario({
      baseline: {
        nowIso: baseline.nowIso,
        currency: baseline.sources.currency,
        walletBalance: baseline.sources.walletBalance,
        coverage: baseline.money.coverage,
        statement: baseline.money.statement,
        affordability: baseline.money.affordability,
        weeklyPrediction: baseline.money.weeklyPrediction,
        monthlySurvivalForecast: baseline.money.monthlySurvivalForecast,
        spendingLimits: baseline.money.spendingLimits,
        connectedAccounts: baseline.sources.connectedAccounts,
        billPredictions: baseline.money.billPredictions,
      },
      debtSimulator: baseline.money.advancedIntelligence.debtPayoffSimulator,
      assumptions,
    });

    return NextResponse.json({
      ok: true,
      scenario,
      baseline: baseline.money.advancedIntelligence.scenarioSimulation.baseline,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(apiError("VALIDATION_ERROR", error.message, true), {
        status: error.status,
      });
    }
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      return NextResponse.json(apiError("VALIDATION_ERROR", message, true), { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to run scenario simulation.";
    const errorCode = classifyTaskError({ message });
    logServerEvent("error", "advanced_intelligence.post.failed", {
      errorCode,
      message,
    });
    return NextResponse.json(apiError(errorCode, message, true), { status: 500 });
  }
}
