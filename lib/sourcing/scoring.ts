import type { CandidateScoreBreakdown, NormalizedSourcingRequest, StructuredCandidate } from './schemas.ts';

function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function titleRelevance(candidate: StructuredCandidate, request: NormalizedSourcingRequest): number {
  const title = candidate.currentTitle.toLowerCase();
  const role = request.roleQuery.toLowerCase();

  let score = 0;
  if (title.includes('software engineer')) score += 45;
  if (containsToken(title, role)) score += 40;
  if (title.includes('engineer')) score += 15;
  return clamp(score);
}

function seniorityMatch(candidate: StructuredCandidate, request: NormalizedSourcingRequest): number {
  if (request.seniority === 'any') return 75;
  if (candidate.seniorityLevel === request.seniority) return 100;
  if (request.seniority === 'senior' && (candidate.seniorityLevel === 'staff' || candidate.seniorityLevel === 'principal' || candidate.seniorityLevel === 'lead')) {
    return 92;
  }
  if (request.seniority === 'staff' && candidate.seniorityLevel === 'principal') return 88;
  if (request.seniority === 'lead' && candidate.seniorityLevel === 'senior') return 80;
  return 45;
}

function skillsMatch(candidate: StructuredCandidate, request: NormalizedSourcingRequest): number {
  if (request.requiredSkills.length === 0) return 70;

  const corpus = `${candidate.currentTitle} ${candidate.summary} ${(candidate.skills || []).join(' ')}`.toLowerCase();
  const matched = request.requiredSkills.filter((skill) => containsToken(corpus, skill.toLowerCase()));
  const ratio = matched.length / request.requiredSkills.length;

  return clamp(Math.round(ratio * 100));
}

function experienceScore(candidate: StructuredCandidate): number {
  if (candidate.yearsExperience === null) return 55;
  if (candidate.yearsExperience >= 12) return 95;
  if (candidate.yearsExperience >= 8) return 88;
  if (candidate.yearsExperience >= 5) return 74;
  if (candidate.yearsExperience >= 3) return 60;
  return 42;
}

function companyRelevance(candidate: StructuredCandidate): number {
  if (candidate.companyHistory.length >= 5) return 90;
  if (candidate.companyHistory.length >= 3) return 78;
  if (candidate.companyHistory.length >= 1) return 64;
  return 40;
}

function locationFit(candidate: StructuredCandidate, request: NormalizedSourcingRequest): number {
  if (!request.location) return 75;

  const candidateLocation = candidate.location.toLowerCase();
  const target = request.location.toLowerCase();
  if (candidateLocation.includes(target) || target.includes(candidateLocation)) return 100;

  const sameState = candidateLocation.split(',').pop()?.trim() === target.split(',').pop()?.trim();
  if (sameState) return 72;
  return 48;
}

function remoteFit(candidate: StructuredCandidate, request: NormalizedSourcingRequest): number {
  if (request.remotePreference === 'any') return 75;
  if (candidate.remoteStatus === request.remotePreference) return 100;
  if (request.remotePreference === 'remote' && candidate.remoteStatus === 'hybrid') return 62;
  return 40;
}

function completeness(candidate: StructuredCandidate): number {
  const checks = [
    candidate.fullName !== 'Unknown candidate',
    candidate.currentTitle.length > 0,
    candidate.location.length > 0,
    candidate.skills.length > 0,
    candidate.summary.length > 0,
    candidate.companyHistory.length > 0,
    candidate.education !== null,
    candidate.yearsExperience !== null,
  ];

  const passCount = checks.filter(Boolean).length;
  return clamp(Math.round((passCount / checks.length) * 100));
}

function extractionConfidenceScore(candidate: StructuredCandidate): number {
  return clamp(Math.round(candidate.extractionConfidence * 100));
}

function weightedTotal(breakdown: Omit<CandidateScoreBreakdown, 'weightedTotal'>): number {
  const weights: Record<keyof Omit<CandidateScoreBreakdown, 'weightedTotal'>, number> = {
    titleRelevance: 0.2,
    seniorityMatch: 0.14,
    skillsMatch: 0.22,
    yearsExperience: 0.1,
    companyRelevance: 0.08,
    locationFit: 0.08,
    remoteFit: 0.06,
    profileCompleteness: 0.06,
    extractionConfidence: 0.06,
  };

  const total = Object.entries(breakdown).reduce((sum, [key, value]) => {
    const weight = weights[key as keyof typeof weights] || 0;
    return sum + (value * weight);
  }, 0);

  return clamp(Math.round(total));
}

function buildReasons(breakdown: CandidateScoreBreakdown, request: NormalizedSourcingRequest): string[] {
  const reasons: string[] = [];

  if (breakdown.skillsMatch >= 80 && request.requiredSkills.length > 0) {
    reasons.push(`Matches most required skills (${request.requiredSkills.slice(0, 4).join(', ')}).`);
  }
  if (breakdown.seniorityMatch >= 90) {
    reasons.push(`Seniority aligns with requested ${request.seniority} level.`);
  }
  if (breakdown.titleRelevance >= 80) {
    reasons.push('Current role is highly relevant to the request.');
  }
  if (breakdown.locationFit >= 80) {
    reasons.push('Location fit is strong for the search target.');
  }
  if (breakdown.remoteFit >= 90 && request.remotePreference !== 'any') {
    reasons.push(`Remote preference matches (${request.remotePreference}).`);
  }

  if (reasons.length === 0) {
    reasons.push('Profile fit is acceptable based on available extracted data.');
  }

  return reasons.slice(0, 4);
}

function buildRisks(candidate: StructuredCandidate, breakdown: CandidateScoreBreakdown): string[] {
  const risks: string[] = [];
  if (candidate.yearsExperience === null) risks.push('Years of experience could not be verified.');
  if (candidate.skills.length === 0) risks.push('Skill details are sparse on the profile.');
  if (breakdown.extractionConfidence < 55) risks.push('Extraction confidence is below preferred threshold.');
  if (candidate.remoteStatus === 'unknown') risks.push('Remote status is not explicitly listed.');
  return risks.slice(0, 4);
}

export function scoreCandidate(candidate: StructuredCandidate, request: NormalizedSourcingRequest): StructuredCandidate {
  const partial = {
    titleRelevance: titleRelevance(candidate, request),
    seniorityMatch: seniorityMatch(candidate, request),
    skillsMatch: skillsMatch(candidate, request),
    yearsExperience: experienceScore(candidate),
    companyRelevance: companyRelevance(candidate),
    locationFit: locationFit(candidate, request),
    remoteFit: remoteFit(candidate, request),
    profileCompleteness: completeness(candidate),
    extractionConfidence: extractionConfidenceScore(candidate),
  };

  const fullBreakdown: CandidateScoreBreakdown = {
    ...partial,
    weightedTotal: weightedTotal(partial),
  };

  return {
    ...candidate,
    score: fullBreakdown.weightedTotal,
    scoringBreakdown: fullBreakdown,
    matchReasons: buildReasons(fullBreakdown, request),
    risks: buildRisks(candidate, fullBreakdown),
  };
}

export function rankCandidates(candidates: StructuredCandidate[], request: NormalizedSourcingRequest): StructuredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, request))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.extractionConfidence !== left.extractionConfidence) {
        return right.extractionConfidence - left.extractionConfidence;
      }
      return left.fullName.localeCompare(right.fullName);
    });
}
