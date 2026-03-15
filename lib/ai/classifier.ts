export type ClassifiedRequestType = 'research' | 'general' | 'task';

const TASK_PATTERNS: RegExp[] = [
  /\b(sign[\s-]?up|register|create account)\b/i,
  /\b(buy|purchase|checkout|order|subscribe|cancel subscription|downgrade|upgrade)\b/i,
  /\b(fill( out)?|submit|complete)\s+(a\s+)?(form|application)\b/i,
  /\b(navigate|browse|open (the )?(website|site)|click|scrape|extract from)\b/i,
  /\b(automate|automation|run (this )?for me|do this for me)\b/i,
  /\b(log[\s-]?in|login)\b/i,
];

const GENERAL_PATTERNS: RegExp[] = [
  /\b(calico|wallet|account|profile|card|balance|transaction|billing|subscription)\b/i,
  /\b(connect (my )?card\b|\badd (a )?card\b|\blink (a )?card\b)/i,
  /\b(feature|features|setting|settings|help|support|how do i|how can i)\b/i,
];

const RESEARCH_PATTERNS: RegExp[] = [
  /\b(best|top|recommend|recommendation|suggest|suggestion)\b/i,
  /\b(compare|comparison|vs\.?|versus|alternatives?|options)\b/i,
  /\b(explain|overview|difference between|pros and cons)\b/i,
  /\b(under \$?\d+|price range|budget)\b/i,
];

function scoreMatch(input: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => (pattern.test(input) ? score + 1 : score), 0);
}

export function classifyRequest(input: string): ClassifiedRequestType {
  const normalized = input.trim();
  if (!normalized) return 'general';

  const taskScore = scoreMatch(normalized, TASK_PATTERNS);
  const generalScore = scoreMatch(normalized, GENERAL_PATTERNS);
  const researchScore = scoreMatch(normalized, RESEARCH_PATTERNS);

  if (taskScore > 0 && taskScore >= generalScore && taskScore >= researchScore) {
    return 'task';
  }

  if (generalScore > 0 && generalScore >= researchScore) {
    return 'general';
  }

  return 'research';
}
