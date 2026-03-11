import { z } from 'zod';

export const SourcingTaskStatusSchema = z.enum([
  'queued',
  'running',
  'parsing',
  'scoring',
  'exporting',
  'completed',
  'failed',
  'partial_success',
]);

export type SourcingTaskStatus = z.infer<typeof SourcingTaskStatusSchema>;

export const RemotePreferenceSchema = z.enum(['any', 'remote', 'hybrid', 'onsite']);

export const NormalizedSourcingRequestSchema = z.object({
  platform: z.literal('indeed'),
  roleQuery: z.string().trim().min(1),
  location: z.string().trim().nullable(),
  remotePreference: RemotePreferenceSchema,
  requiredSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  preferredSkills: z.array(z.string().trim().min(1)).max(20).default([]),
  seniority: z.enum(['senior', 'staff', 'principal', 'lead', 'any']).default('senior'),
  shortlistTarget: z.number().int().min(1).max(10).default(3),
  maxResultPages: z.number().int().min(1).max(10).default(3),
  maxProfilesOpened: z.number().int().min(3).max(60).default(18),
  maxRetries: z.number().int().min(0).max(5).default(1),
  maxExtractionPasses: z.number().int().min(1).max(5).default(2),
  earlyStopScoreThreshold: z.number().min(0).max(100).default(72),
  originalPrompt: z.string().trim().min(1),
});

export type NormalizedSourcingRequest = z.infer<typeof NormalizedSourcingRequestSchema>;

export const SourcingExecutionPlanSchema = z.object({
  taskType: z.literal('candidate_sourcing'),
  platform: z.literal('indeed'),
  baseSearchQuery: z.string().trim().min(1),
  searchQueries: z.array(z.string().trim().min(1)).min(1).max(3),
  bounds: z.object({
    maxResultPages: z.number().int().min(1).max(10),
    maxProfilesOpened: z.number().int().min(3).max(60),
    maxRetries: z.number().int().min(0).max(5),
    maxExtractionPasses: z.number().int().min(1).max(5),
  }),
  stopRules: z.object({
    shortlistTarget: z.number().int().min(1).max(10),
    minHighConfidenceCandidates: z.number().int().min(1).max(10),
    earlyStopScoreThreshold: z.number().min(0).max(100),
  }),
  extractionFields: z.array(z.string().trim().min(1)).min(5),
});

export type SourcingExecutionPlan = z.infer<typeof SourcingExecutionPlanSchema>;

export const RawSourcedCandidateSchema = z.object({
  sourceUrl: z.string().trim().url(),
  fullName: z.string().trim().min(1).nullable().optional(),
  currentTitle: z.string().trim().min(1).nullable().optional(),
  location: z.string().trim().min(1).nullable().optional(),
  remoteStatus: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
  skills: z.array(z.string().trim().min(1)).max(40).optional(),
  companyHistory: z.array(z.string().trim().min(1)).max(25).optional(),
  education: z.string().trim().min(1).nullable().optional(),
  summary: z.string().trim().min(1).nullable().optional(),
  extractionConfidence: z.number().min(0).max(1).nullable().optional(),
});

export type RawSourcedCandidate = z.infer<typeof RawSourcedCandidateSchema>;

export const CandidateScoreBreakdownSchema = z.object({
  titleRelevance: z.number().min(0).max(100),
  seniorityMatch: z.number().min(0).max(100),
  skillsMatch: z.number().min(0).max(100),
  yearsExperience: z.number().min(0).max(100),
  companyRelevance: z.number().min(0).max(100),
  locationFit: z.number().min(0).max(100),
  remoteFit: z.number().min(0).max(100),
  profileCompleteness: z.number().min(0).max(100),
  extractionConfidence: z.number().min(0).max(100),
  weightedTotal: z.number().min(0).max(100),
});

export type CandidateScoreBreakdown = z.infer<typeof CandidateScoreBreakdownSchema>;

export const StructuredCandidateSchema = z.object({
  sourcePlatform: z.literal('indeed'),
  sourceUrl: z.string().trim().url(),
  fullName: z.string().trim().min(1),
  currentTitle: z.string().trim().min(1),
  seniorityLevel: z.enum(['senior', 'staff', 'principal', 'lead', 'unknown']),
  location: z.string().trim().min(1),
  remoteStatus: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  yearsExperience: z.number().min(0).max(60).nullable(),
  skills: z.array(z.string().trim().min(1)).max(40),
  companyHistory: z.array(z.string().trim().min(1)).max(25),
  education: z.string().trim().nullable(),
  summary: z.string().trim().min(1),
  matchReasons: z.array(z.string().trim().min(1)).max(10),
  score: z.number().min(0).max(100),
  scoringBreakdown: CandidateScoreBreakdownSchema,
  extractionConfidence: z.number().min(0).max(1),
  parsedAt: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  risks: z.array(z.string().trim().min(1)).max(8),
});

export type StructuredCandidate = z.infer<typeof StructuredCandidateSchema>;

export const SourcingActionLogSchema = z.object({
  at: z.string(),
  phase: z.enum(['queued', 'planning', 'parsing', 'scoring', 'exporting', 'completed', 'failed']),
  message: z.string().trim().min(1),
  stats: z.record(z.string(), z.unknown()).optional(),
});

export type SourcingActionLog = z.infer<typeof SourcingActionLogSchema>;

export const SourcingTaskResultSchema = z.object({
  taskId: z.string().trim().min(1),
  status: SourcingTaskStatusSchema,
  summary: z.string().trim().min(1),
  normalizedRequest: NormalizedSourcingRequestSchema,
  executionPlan: SourcingExecutionPlanSchema,
  extractedCandidates: z.array(StructuredCandidateSchema),
  shortlist: z.array(StructuredCandidateSchema).max(3),
  metrics: z.object({
    totalExtracted: z.number().int().min(0),
    dedupedCount: z.number().int().min(0),
    extractionPasses: z.number().int().min(0),
    profilesVisited: z.number().int().min(0),
    resultPagesVisited: z.number().int().min(0),
    retriesUsed: z.number().int().min(0),
    earlyStopTriggered: z.boolean(),
    scoringDurationMs: z.number().int().min(0),
    exportDurationMs: z.number().int().min(0),
    totalDurationMs: z.number().int().min(0),
  }),
  efficiency: z.object({
    passBudget: z.number().int().min(0),
    passesUsed: z.number().int().min(0),
    passesAvoided: z.number().int().min(0),
    duplicateCandidatesSkipped: z.number().int().min(0),
    invalidCandidatesDropped: z.number().int().min(0),
    estimatedBrowserStepsAvoided: z.number().int().min(0),
  }).optional(),
  export: z.object({
    sheetId: z.string().trim().nullable(),
    sheetUrl: z.string().trim().nullable(),
    tabName: z.string().trim().nullable(),
    rowsWritten: z.number().int().min(0),
    exportedAt: z.string().trim().nullable(),
  }),
  errors: z.array(z.object({
    code: z.string().trim().min(1),
    stage: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean().default(false),
  })),
  actionLogs: z.array(SourcingActionLogSchema),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export type SourcingTaskResult = z.infer<typeof SourcingTaskResultSchema>;
