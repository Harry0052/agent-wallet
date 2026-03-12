export interface CandidateProfile {
  name: string;
  title: string;
  location: string;
  skills: string[];
  years_experience: number;
  profile_link: string;
}

export interface ScoredCandidate {
  name: string;
  title: string;
  location: string;
  skills: string[];
  years_experience: number;
  profile_link: string;
  score: number;
}

export interface CandidateScoreBreakdown {
  experience_weight: number;
  skill_match: number;
  profile_completeness: number;
}

export function scoreCandidate(
  candidate: CandidateProfile,
  query: string,
): ScoredCandidate {
  const breakdown = buildScoreBreakdown(candidate, query);
  const totalScore =
    breakdown.experience_weight +
    breakdown.skill_match +
    breakdown.profile_completeness;

  return {
    ...candidate,
    score: Number(totalScore.toFixed(2)),
  };
}

export function scoreCandidates(
  candidates: CandidateProfile[],
  query: string,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, query))
    .sort((a, b) => b.score - a.score);
}

function buildScoreBreakdown(
  candidate: CandidateProfile,
  query: string,
): CandidateScoreBreakdown {
  const experience_weight = calculateExperienceWeight(candidate.years_experience);
  const skill_match = calculateSkillMatch(candidate, query);
  const profile_completeness = calculateProfileCompleteness(candidate);

  return {
    experience_weight,
    skill_match,
    profile_completeness,
  };
}

function calculateExperienceWeight(yearsExperience: number): number {
  const boundedYears = Math.max(0, Math.min(yearsExperience, 15));
  return (boundedYears / 15) * 50;
}

function calculateSkillMatch(candidate: CandidateProfile, query: string): number {
  const keywords = tokenizeQuery(query);
  if (keywords.length === 0) {
    return 0;
  }

  const searchableText = `${candidate.title} ${candidate.skills.join(" ")}`.toLowerCase();
  const matchCount = keywords.filter((keyword) =>
    searchableText.includes(keyword),
  ).length;

  return (matchCount / keywords.length) * 35;
}

function calculateProfileCompleteness(candidate: CandidateProfile): number {
  const checks = [
    candidate.name.trim().length > 0,
    candidate.title.trim().length > 0,
    candidate.location.trim().length > 0,
    candidate.skills.length > 0,
    candidate.years_experience > 0,
    candidate.profile_link.trim().length > 0,
  ];
  const completionRatio = checks.filter(Boolean).length / checks.length;

  return completionRatio * 15;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}
