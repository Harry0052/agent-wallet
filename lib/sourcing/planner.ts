import {
  SourcingExecutionPlanSchema,
  type NormalizedSourcingRequest,
  type SourcingExecutionPlan,
  type StructuredCandidate,
} from './schemas.ts';

const EXTRACTION_FIELDS = [
  'sourceUrl',
  'fullName',
  'currentTitle',
  'location',
  'remoteStatus',
  'yearsExperience',
  'skills',
  'companyHistory',
  'education',
  'summary',
  'extractionConfidence',
];

function buildSearchQuery(request: NormalizedSourcingRequest): string {
  const parts = [request.roleQuery];

  if (request.seniority !== 'any' && !request.roleQuery.toLowerCase().includes(request.seniority)) {
    parts.push(request.seniority);
  }

  if (request.requiredSkills.length > 0) {
    parts.push(request.requiredSkills.slice(0, 4).join(' '));
  }

  if (request.remotePreference === 'remote') {
    parts.push('remote');
  } else if (request.location) {
    parts.push(request.location);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function buildSourcingExecutionPlan(request: NormalizedSourcingRequest): SourcingExecutionPlan {
  const base = buildSearchQuery(request);

  const queries = [
    base,
    `${request.roleQuery} ${request.requiredSkills.slice(0, 2).join(' ')}`.replace(/\s+/g, ' ').trim(),
    `${request.roleQuery} ${request.remotePreference === 'any' ? '' : request.remotePreference}`.replace(/\s+/g, ' ').trim(),
  ].filter(Boolean);

  const dedupedQueries = Array.from(new Set(queries)).slice(0, request.maxExtractionPasses);

  return SourcingExecutionPlanSchema.parse({
    taskType: 'candidate_sourcing',
    platform: 'indeed',
    baseSearchQuery: base,
    searchQueries: dedupedQueries,
    bounds: {
      maxResultPages: request.maxResultPages,
      maxProfilesOpened: request.maxProfilesOpened,
      maxRetries: request.maxRetries,
      maxExtractionPasses: request.maxExtractionPasses,
    },
    stopRules: {
      shortlistTarget: request.shortlistTarget,
      minHighConfidenceCandidates: request.shortlistTarget,
      earlyStopScoreThreshold: request.earlyStopScoreThreshold,
    },
    extractionFields: EXTRACTION_FIELDS,
  });
}

export function queryForPass(plan: SourcingExecutionPlan, passIndex: number): string {
  if (passIndex < plan.searchQueries.length) return plan.searchQueries[passIndex];
  return plan.searchQueries[plan.searchQueries.length - 1];
}

export function shouldRetryPass(params: {
  retriesUsed: number;
  maxRetries: number;
  errorCode: string;
  stateChanged: boolean;
}): boolean {
  if (params.retriesUsed >= params.maxRetries) return false;
  if (!params.stateChanged) return false;
  return params.errorCode === 'TIMEOUT'
    || params.errorCode === 'TRANSIENT_UPSTREAM'
    || params.errorCode === 'RATE_LIMIT';
}

export function shouldEarlyStop(params: {
  shortlisted: StructuredCandidate[];
  target: number;
  threshold: number;
  passIndex: number;
  maxPasses: number;
  alternativesImproving: boolean;
}): boolean {
  if (params.shortlisted.length < params.target) return false;

  const top = params.shortlisted.slice(0, params.target);
  const allHighConfidence = top.every((candidate) => candidate.score >= params.threshold);

  if (!allHighConfidence) return false;
  if (params.alternativesImproving) return false;

  // Always stop on final pass.
  if (params.passIndex >= params.maxPasses - 1) return true;

  // Stop after first pass once strong candidates are found.
  return true;
}
