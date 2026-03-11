import {
  RawSourcedCandidateSchema,
  StructuredCandidateSchema,
  type NormalizedSourcingRequest,
  type RawSourcedCandidate,
  type StructuredCandidate,
} from './schemas.ts';

function cleanText(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function inferRemoteStatus(candidate: RawSourcedCandidate): StructuredCandidate['remoteStatus'] {
  if (candidate.remoteStatus) return candidate.remoteStatus;

  const location = (candidate.location || '').toLowerCase();
  const title = (candidate.currentTitle || '').toLowerCase();
  const summary = (candidate.summary || '').toLowerCase();
  const combined = `${location} ${title} ${summary}`;

  if (combined.includes('remote')) return 'remote';
  if (combined.includes('hybrid')) return 'hybrid';
  if (combined.includes('on-site') || combined.includes('onsite')) return 'onsite';
  return 'unknown';
}

function inferSeniority(currentTitle: string): StructuredCandidate['seniorityLevel'] {
  const lower = currentTitle.toLowerCase();
  if (lower.includes('principal')) return 'principal';
  if (lower.includes('staff')) return 'staff';
  if (lower.includes('lead')) return 'lead';
  if (lower.includes('senior') || lower.includes('sr.')) return 'senior';
  return 'unknown';
}

function normalizeSkills(skills: string[] | undefined, summary: string): string[] {
  const values = [...(skills || [])];
  const summaryTokens = summary
    .split(/[,|/]/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token.length < 36);

  values.push(...summaryTokens.slice(0, 8));

  return Array.from(new Set(values
    .map((value) => value.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean))).slice(0, 30);
}

function buildStructuredCandidate(params: {
  raw: RawSourcedCandidate;
  taskId: string;
  request: NormalizedSourcingRequest;
}): StructuredCandidate | null {
  const candidate = params.raw;
  const currentTitle = cleanText(candidate.currentTitle, params.request.roleQuery);
  const summary = cleanText(candidate.summary, currentTitle);
  const fullName = cleanText(candidate.fullName, 'Unknown candidate');
  const location = cleanText(candidate.location, params.request.location || 'Location not listed');

  const structured = {
    sourcePlatform: 'indeed' as const,
    sourceUrl: candidate.sourceUrl,
    fullName,
    currentTitle,
    seniorityLevel: inferSeniority(currentTitle),
    location,
    remoteStatus: inferRemoteStatus(candidate),
    yearsExperience: candidate.yearsExperience ?? null,
    skills: normalizeSkills(candidate.skills, summary),
    companyHistory: (candidate.companyHistory || []).slice(0, 15),
    education: candidate.education || null,
    summary,
    matchReasons: [],
    score: 0,
    scoringBreakdown: {
      titleRelevance: 0,
      seniorityMatch: 0,
      skillsMatch: 0,
      yearsExperience: 0,
      companyRelevance: 0,
      locationFit: 0,
      remoteFit: 0,
      profileCompleteness: 0,
      extractionConfidence: 0,
      weightedTotal: 0,
    },
    extractionConfidence: candidate.extractionConfidence ?? 0.62,
    parsedAt: new Date().toISOString(),
    taskId: params.taskId,
    risks: [],
  };

  const validated = StructuredCandidateSchema.safeParse(structured);
  return validated.success ? validated.data : null;
}

export function toStructuredCandidate(params: {
  raw: unknown;
  taskId: string;
  request: NormalizedSourcingRequest;
}): StructuredCandidate | null {
  const parsed = RawSourcedCandidateSchema.safeParse(params.raw);
  if (!parsed.success) return null;

  return buildStructuredCandidate({
    raw: parsed.data,
    taskId: params.taskId,
    request: params.request,
  });
}

export function toStructuredCandidateFromRaw(params: {
  raw: RawSourcedCandidate;
  taskId: string;
  request: NormalizedSourcingRequest;
}): StructuredCandidate | null {
  return buildStructuredCandidate(params);
}
