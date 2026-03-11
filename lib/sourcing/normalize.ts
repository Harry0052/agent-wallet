import { NormalizedSourcingRequestSchema, type NormalizedSourcingRequest } from './schemas.ts';

const COMMON_SKILLS = [
  'typescript',
  'javascript',
  'node.js',
  'node',
  'react',
  'next.js',
  'nextjs',
  'python',
  'java',
  'kotlin',
  'go',
  'rust',
  'aws',
  'gcp',
  'azure',
  'postgresql',
  'postgres',
  'graphql',
  'microservices',
  'kubernetes',
  'docker',
  'distributed systems',
  'llm',
  'ai',
  'machine learning',
];

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseLocation(message: string): string | null {
  const lower = message.toLowerCase();

  if (/(\bremote\b|work\s+from\s+home|anywhere)/.test(lower)) {
    return null;
  }

  const inMatch = message.match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z .,'-]{1,50})(?:\bwith\b|\bfor\b|\bwho\b|$)/i);
  if (inMatch?.[1]) {
    return cleanWhitespace(inMatch[1].replace(/[.,]+$/, ''));
  }

  return null;
}

function parseRemotePreference(message: string): NormalizedSourcingRequest['remotePreference'] {
  const lower = message.toLowerCase();
  if (/\bremote\b/.test(lower)) return 'remote';
  if (/\bhybrid\b/.test(lower)) return 'hybrid';
  if (/\bonsite\b|on-site|on site/.test(lower)) return 'onsite';
  return 'any';
}

function parseSeniority(message: string): NormalizedSourcingRequest['seniority'] {
  const lower = message.toLowerCase();
  if (/\bprincipal\b/.test(lower)) return 'principal';
  if (/\bstaff\b/.test(lower)) return 'staff';
  if (/\blead\b/.test(lower)) return 'lead';
  if (/\bsenior\b/.test(lower)) return 'senior';
  return 'senior';
}

function parseRoleQuery(message: string): string {
  const lower = message.toLowerCase();
  const roleHints = [
    'senior software engineer',
    'staff software engineer',
    'principal software engineer',
    'lead software engineer',
    'software engineer',
    'backend engineer',
    'frontend engineer',
    'full stack engineer',
    'full-stack engineer',
  ];

  for (const hint of roleHints) {
    if (lower.includes(hint)) return hint;
  }

  return 'senior software engineer';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function parseSkills(message: string): { requiredSkills: string[]; preferredSkills: string[] } {
  const lower = message.toLowerCase();
  const requiredSkills: string[] = [];

  const withExperience = message.match(/\bexperience\s+in\s+(.+?)(?:\.|,\s*and\s+|\sand\s+shortlist|\sand\s+find|$)/i);
  if (withExperience?.[1]) {
    const tokens = withExperience[1]
      .split(/,|\band\b|\//i)
      .map((token) => cleanWhitespace(token))
      .filter(Boolean);
    requiredSkills.push(...tokens);
  }

  for (const skill of COMMON_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
      requiredSkills.push(skill);
    }
  }

  const normalizedRequired = unique(requiredSkills).slice(0, 12);

  const preferredSkills = normalizedRequired.filter((skill) => (
    skill === 'distributed systems'
    || skill === 'microservices'
    || skill === 'kubernetes'
    || skill === 'aws'
    || skill === 'gcp'
    || skill === 'azure'
  ));

  return {
    requiredSkills: normalizedRequired,
    preferredSkills: unique(preferredSkills).slice(0, 6),
  };
}

function parseSearchDepth(message: string): Pick<
  NormalizedSourcingRequest,
  'maxResultPages' | 'maxProfilesOpened' | 'maxRetries' | 'maxExtractionPasses'
> {
  const lower = message.toLowerCase();

  // Keep exploration bounded by default; allow explicit widening when user asks broad scan.
  if (/\bdeep\b|\bcomprehensive\b|\bthorough\b|\bwide\b/.test(lower)) {
    return {
      maxResultPages: 4,
      maxProfilesOpened: 24,
      maxRetries: 2,
      maxExtractionPasses: 3,
    };
  }

  return {
    maxResultPages: 3,
    maxProfilesOpened: 18,
    maxRetries: 1,
    maxExtractionPasses: 2,
  };
}

export function normalizeSourcingRequest(prompt: string): NormalizedSourcingRequest {
  const cleaned = cleanWhitespace(prompt);
  const roleQuery = parseRoleQuery(cleaned);
  const location = parseLocation(cleaned);
  const remotePreference = parseRemotePreference(cleaned);
  const seniority = parseSeniority(cleaned);
  const { requiredSkills, preferredSkills } = parseSkills(cleaned);
  const depth = parseSearchDepth(cleaned);

  return NormalizedSourcingRequestSchema.parse({
    platform: 'indeed',
    roleQuery,
    location,
    remotePreference,
    requiredSkills,
    preferredSkills,
    seniority,
    shortlistTarget: 3,
    maxResultPages: depth.maxResultPages,
    maxProfilesOpened: depth.maxProfilesOpened,
    maxRetries: depth.maxRetries,
    maxExtractionPasses: depth.maxExtractionPasses,
    earlyStopScoreThreshold: 72,
    originalPrompt: cleaned,
  });
}
