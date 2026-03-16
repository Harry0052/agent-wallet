export type MoneySourceState = 'synced' | 'manual' | 'mixed';

export type MoneyTransactionKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'refund'
  | 'reversal'
  | 'credit_card_payment'
  | 'duplicate'
  | 'pending'
  | 'ignored';

export interface MoneyTransactionInput {
  id: string;
  merchantName: string;
  normalizedMerchant: string;
  amount: number;
  category: string;
  pending: boolean;
  occurredAt: string;
  linkedAccountId?: string;
}

export interface MoneyRecurringInput {
  id: string;
  merchant: string;
  estimatedMonthlyCost: number;
  recurrenceInterval: string;
  confidence: number;
  lastSeen: string;
  lifecycleStatus?: 'detected' | 'confirmed' | 'ignored' | 'inactive' | 'manual';
}

export interface MoneyConnectedAccountInput {
  id: string;
  lastSyncedAt: string | null;
  balance?: number;
  type?: string;
}

export interface MoneyCategoryRule {
  normalizedMerchant: string;
  learnedCategory: string;
  supportCount: number;
  totalCorrections: number;
  dominanceRatio: number;
  confidence: number;
  lastCorrectedAt: string;
  status: 'active' | 'pending';
}

export interface MoneyConfidenceExplainability {
  confidence: number;
  explanation: string;
  factors: string[];
}

export interface MoneyStatementAggregation extends MoneyConfidenceExplainability {
  currency: string;
  totalTransactions: number;
  spendTransactions: number;
  incomeTransactions: number;
  transferTransactions: number;
  refundTransactions: number;
  reversalTransactions: number;
  creditCardPaymentTransactions: number;
  duplicateTransactions: number;
  pendingTransactions: number;
  ignoredTransactions: number;
  trueSpendAmount: number;
  trueIncomeAmount: number;
  transferAmount: number;
  refundAmount: number;
  reversalAmount: number;
  creditCardPaymentAmount: number;
  duplicateAmount: number;
  netCashFlow: number;
  classifiedTransactions: Array<{
    id: string;
    kind: MoneyTransactionKind;
    amount: number;
    category: string;
    effectiveCategory: string;
    occurredAt: string;
    merchant: string;
  }>;
}

export interface MoneyNetWorthTracking extends MoneyConfidenceExplainability {
  trackedNetWorth: number;
  assets: number;
  liabilities: number;
  walletBalance: number;
  knownAccountCount: number;
  trend7d: Array<{ date: string; netWorth: number }>;
  delta7d: number;
}

export interface MoneySpendingLimits extends MoneyConfidenceExplainability {
  dailyLimit: number;
  weeklyLimit: number;
  monthlyLimit: number;
  categoryBudgets: Array<{
    category: string;
    recommendedMonthlyBudget: number;
    observedMonthlySpend: number;
  }>;
}

export interface MoneyAffordability extends MoneyConfidenceExplainability {
  safeToSpendToday: number;
  safeToSpendThisWeek: number;
  safeToSpendThisMonth: number;
  safeToSpendUntilNextIncome: number | null;
  nextIncomeDate: string | null;
  incomeCadenceReliable: boolean;
  dailyEssentialSpend: number;
}

export interface MoneyWeeklyPrediction extends MoneyConfidenceExplainability {
  predictedSpendNext7d: number;
  predictedDailyBurn: number;
  observedSpendLast7d: number;
}

export interface MoneyMonthlySurvivalForecast extends MoneyConfidenceExplainability {
  projectedIncome30d: number;
  projectedBills30d: number;
  projectedVariableSpend30d: number;
  projectedEndBalance30d: number;
  estimatedRunwayDays: number | null;
  status: 'safe' | 'watch' | 'risk';
}

export interface MoneyBillPrediction extends MoneyConfidenceExplainability {
  id: string;
  merchant: string;
  amount: number;
  dueDate: string;
  intervalDays: number;
  source: 'subscription' | 'recurrence';
}

export interface MoneySubscriptionTimelineItem extends MoneyConfidenceExplainability {
  id: string;
  merchant: string;
  monthlyCost: number;
  lastSeen: string;
  nextExpectedChargeDate: string | null;
  lifecycleStatus: string;
}

export interface MoneyAlert extends MoneyConfidenceExplainability {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind:
    | 'daily_limit'
    | 'weekly_limit'
    | 'survival_risk'
    | 'bill_spike'
    | 'data_stale';
  title: string;
  summary: string;
}

export interface MoneyCategoryLearningSummary extends MoneyConfidenceExplainability {
  appliedRules: number;
  pendingRules: number;
  learnedMerchants: number;
  activeRules: MoneyCategoryRule[];
}

export interface MoneyCoverage extends MoneyConfidenceExplainability {
  sourceState: MoneySourceState;
  lowData: boolean;
  staleAccountCount: number;
  connectedAccountCount: number;
  transactionCoverageDays: number;
  insufficientDataReasons: string[];
}

export type MoneyStudentCardId =
  | 'can_i_afford_tonight'
  | 'refund_survival'
  | 'meal_balance'
  | 'rent_split'
  | 'paycheck_forecast'
  | 'loan_watch';

export interface MoneyStudentCard extends MoneyConfidenceExplainability {
  id: MoneyStudentCardId;
  title: string;
  summary: string;
  status: 'good' | 'watch' | 'risk' | 'manual';
  amount: number | null;
  amountLabel: string;
}

export interface MoneyStudentRefundBudgeting extends MoneyConfidenceExplainability {
  latestRefundLikeDepositAmount: number | null;
  latestRefundLikeDepositDate: string | null;
  semesterDaysPlanned: number;
  weeklyRunwayBudget: number | null;
  estimatedRunwayDays: number | null;
  manualTrackingRecommended: boolean;
}

export interface MoneyStudentMealPlanTracking extends MoneyConfidenceExplainability {
  estimatedSpend7d: number;
  estimatedSpend30d: number;
  estimatedWeeklyBudget: number | null;
  estimatedWeeklyRemaining: number | null;
  manualTrackingRecommended: boolean;
}

export interface MoneyStudentDormExpenseTracking extends MoneyConfidenceExplainability {
  estimatedDormSpend30d: number;
  upcomingDormBillAmount: number | null;
  upcomingDormBillDate: string | null;
  manualTrackingRecommended: boolean;
}

export interface MoneyStudentRentSplit extends MoneyConfidenceExplainability {
  latestRentAmount: number | null;
  latestRentDate: string | null;
  inferredRoommateCount: number | null;
  suggestedPerPersonShare: number | null;
  reimbursedByRoommates: number;
  stillToCollect: number | null;
  manualTrackingRecommended: boolean;
}

export interface MoneyStudentP2PTracking extends MoneyConfidenceExplainability {
  sent30d: number;
  received30d: number;
  netOutflow30d: number;
  dedupedMirroredPairs30d: number;
  uniqueTransferCount30d: number;
}

export interface MoneyStudentNightlifeAffordability extends MoneyConfidenceExplainability {
  suggestedTonightLimit: number;
  typicalNightSpend: number | null;
  canAffordTypicalNight: boolean;
}

export interface MoneyStudentInternshipIncomeTracking extends MoneyConfidenceExplainability {
  internshipIncomeLast30d: number;
  averagePaycheckAmount: number | null;
  nextExpectedPaycheckDate: string | null;
  projectedIncome30d: number;
  cadenceReliable: boolean;
  manualTrackingRecommended: boolean;
}

export interface MoneyStudentLoanMonitoring extends MoneyConfidenceExplainability {
  trackedLoanBalance: number;
  loanBills30d: number;
  nextLoanPaymentAmount: number | null;
  nextLoanPaymentDate: string | null;
  status: 'clear' | 'watch' | 'risk' | 'manual';
}

export interface MoneyStudentInsight extends MoneyConfidenceExplainability {
  id: string;
  kind:
    | 'refund_runway'
    | 'meal_balance'
    | 'rent_split'
    | 'nightlife'
    | 'paycheck_forecast'
    | 'loan_watch'
    | 'p2p_dedup';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string;
}

export interface MoneyStudentFocus extends MoneyConfidenceExplainability {
  cards: MoneyStudentCard[];
  refundBudgeting: MoneyStudentRefundBudgeting;
  mealPlan: MoneyStudentMealPlanTracking;
  dormExpenses: MoneyStudentDormExpenseTracking;
  rentSplit: MoneyStudentRentSplit;
  p2pTracking: MoneyStudentP2PTracking;
  nightlife: MoneyStudentNightlifeAffordability;
  internshipIncome: MoneyStudentInternshipIncomeTracking;
  loanMonitoring: MoneyStudentLoanMonitoring;
  insights: MoneyStudentInsight[];
}

export interface MoneyLifeGoalPlanItem extends MoneyConfidenceExplainability {
  id: 'emergency_buffer' | 'debt_free' | 'starter_investing';
  title: string;
  targetAmount: number;
  currentAmount: number;
  gapAmount: number;
  monthlyContributionPlan: number;
  monthsToGoal: number | null;
  status: 'on_track' | 'watch' | 'off_track' | 'manual';
}

export interface MoneyLifeGoalPlanning extends MoneyConfidenceExplainability {
  monthlyContributionCapacity: number;
  recommendedContributionNow: number;
  goals: MoneyLifeGoalPlanItem[];
}

export interface MoneyRetirementProjection extends MoneyConfidenceExplainability {
  yearsProjected: number;
  currentInvestedAssets: number;
  projectedPortfolioValue: number;
  targetNestEgg: number;
  readinessRatio: number;
  monthlyContributionAssumption: number;
  recommendedMonthlyContribution: number;
  status: 'track_on' | 'needs_boost' | 'off_track' | 'manual';
}

export interface MoneyScenarioAssumptions {
  id: string;
  label: string;
  spendingChangePct: number;
  incomeChangePct: number;
  extraDebtPaydownMonthly: number;
  savingsContributionMonthly: number;
}

export interface MoneyScenarioSimulation extends MoneyConfidenceExplainability {
  id: string;
  label: string;
  assumptions: MoneyScenarioAssumptions;
  projectedEndBalance30d: number;
  projectedEndBalance90d: number;
  safeToSpendToday: number;
  safeToSpendThisWeek: number;
  safeToSpendThisMonth: number;
  stressLevel: 'low' | 'watch' | 'high' | 'critical';
}

export interface MoneyInvestmentPortfolioAnalysis extends MoneyConfidenceExplainability {
  portfolioValue: number;
  investmentAccountCount: number;
  largestHoldingSharePct: number;
  diversificationScore: number;
  cashConcentrationPct: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'manual';
  recommendation: string;
}

export interface MoneyCreditUtilizationAccountTarget {
  accountId: string;
  accountName: string;
  currentBalance: number;
  estimatedLimit: number;
  utilizationRatio: number;
  paymentToReachSafeUtilization: number;
}

export interface MoneyCreditUtilizationOptimizer extends MoneyConfidenceExplainability {
  utilizationRatio: number | null;
  safeUtilizationTargetRatio: number;
  idealUtilizationTargetRatio: number;
  recommendedPaymentThisMonth: number;
  paymentToReachSafeUtilization: number;
  paymentToReachIdealUtilization: number;
  accountTargets: MoneyCreditUtilizationAccountTarget[];
  status: 'safe' | 'watch' | 'high' | 'manual';
}

export interface MoneyDebtSnapshot {
  id: string;
  name: string;
  balance: number;
  aprEstimate: number;
  minPayment: number;
}

export interface MoneyDebtPayoffStrategyResult extends MoneyConfidenceExplainability {
  strategy: 'avalanche' | 'snowball';
  monthsToDebtFree: number | null;
  payoffDate: string | null;
  totalInterest: number;
  monthlyPaymentBudget: number;
  firstPriorityDebtId: string | null;
}

export interface MoneyDebtPayoffSimulator extends MoneyConfidenceExplainability {
  debts: MoneyDebtSnapshot[];
  monthlyPaymentBudget: number;
  totalDebtBalance: number;
  debtToIncomeRatio: number | null;
  avalanche: MoneyDebtPayoffStrategyResult;
  snowball: MoneyDebtPayoffStrategyResult;
  recommendedStrategy: 'avalanche' | 'snowball' | 'manual';
  estimatedInterestSavedByAvalanche: number;
}

export interface MoneyFinancialRiskScoring extends MoneyConfidenceExplainability {
  overallRiskScore: number;
  riskBand: 'low' | 'moderate' | 'high' | 'severe';
  componentScores: {
    liquidityRisk: number;
    debtRisk: number;
    incomeRisk: number;
    spendingRisk: number;
    dataRisk: number;
  };
}

export interface MoneySpendingHabitAnalysis extends MoneyConfidenceExplainability {
  averageDailySpend90d: number;
  topCategory: string | null;
  topCategoryConcentrationPct: number;
  discretionarySpendPct: number;
  weekendSpendPct: number;
  spendTrend30dPct: number;
  habitRiskLevel: 'steady' | 'watch' | 'risky';
}

export interface MoneyIncomeStabilityAnalysis extends MoneyConfidenceExplainability {
  reliable: boolean;
  incomeCount90d: number;
  averageIncomeAmount: number;
  incomeAmountVolatilityPct: number;
  averageIncomeIntervalDays: number | null;
  intervalVolatilityPct: number | null;
  nextExpectedIncomeDate: string | null;
}

export interface MoneyFinancialStressDetection extends MoneyConfidenceExplainability {
  stressScore: number;
  status: 'low' | 'watch' | 'high' | 'critical';
  triggers: Array<{
    rule: string;
    points: number;
    evidence: string;
  }>;
}

export interface MoneyAdvancedIntelligence extends MoneyConfidenceExplainability {
  lifeGoalPlanning: MoneyLifeGoalPlanning;
  retirementProjection: MoneyRetirementProjection;
  scenarioSimulation: {
    baseline: MoneyScenarioSimulation;
    whatIfScenarios: MoneyScenarioSimulation[];
  };
  investmentPortfolioAnalysis: MoneyInvestmentPortfolioAnalysis;
  creditUtilizationOptimizer: MoneyCreditUtilizationOptimizer;
  debtPayoffSimulator: MoneyDebtPayoffSimulator;
  financialRiskScoring: MoneyFinancialRiskScoring;
  spendingHabitAnalysis: MoneySpendingHabitAnalysis;
  incomeStabilityAnalysis: MoneyIncomeStabilityAnalysis;
  financialStressDetection: MoneyFinancialStressDetection;
}

export interface MoneyIntelligenceResult {
  generatedAt: string;
  engineVersion: string;
  rulesVersion: string;
  statement: MoneyStatementAggregation;
  coverage: MoneyCoverage;
  netWorth: MoneyNetWorthTracking;
  spendingLimits: MoneySpendingLimits;
  affordability: MoneyAffordability;
  weeklyPrediction: MoneyWeeklyPrediction;
  monthlySurvivalForecast: MoneyMonthlySurvivalForecast;
  billPredictions: MoneyBillPrediction[];
  subscriptionTimeline: MoneySubscriptionTimelineItem[];
  alerts: MoneyAlert[];
  categoryLearning: MoneyCategoryLearningSummary;
  studentFocus: MoneyStudentFocus;
  advancedIntelligence: MoneyAdvancedIntelligence;
}
