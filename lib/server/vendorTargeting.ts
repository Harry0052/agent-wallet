export interface VendorTargetValidation {
  valid: boolean;
  normalized: string;
  reason?: string;
}

interface VendorHint {
  pattern: RegExp;
  vendors: string[];
  clarificationQuestion: string;
}

const MAX_VENDOR_WORDS = 6;
const MAX_VENDOR_LENGTH = 80;

const REQUEST_LEAD_PATTERN = /^(find|compare|buy|get|order|need|want|looking|search|show)\b/i;
const BUDGET_LANGUAGE_PATTERN = /\$|\b(under|budget|dollars?|usd|per\s+month|per\s+year|monthly|yearly|annually|\/mo|\/month|\/yr|\/year)\b/i;
const SENTENCE_PATTERN = /[.?!]/;
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const VENDOR_HINTS: VendorHint[] = [
  {
    pattern: /\b(note[\s-]?taking|notes?|knowledge\s*base)\b/i,
    vendors: ['Notion', 'Evernote', 'Obsidian', 'OneNote', 'Bear'],
    clarificationQuestion: 'Are you looking for note-taking apps like Notion, Evernote, or Obsidian?',
  },
  {
    pattern: /\b(email\s*outreach|outreach|cold\s*email|sales\s*engagement)\b/i,
    vendors: ['Apollo', 'Lemlist', 'Reply.io', 'Mailshake', 'QuickMail'],
    clarificationQuestion: 'Are you looking for outreach tools like Apollo, Lemlist, or Reply.io?',
  },
  {
    pattern: /\bcrm|pipeline\s*management|sales\s*pipeline\b/i,
    vendors: ['HubSpot', 'Pipedrive', 'Zoho CRM', 'Freshsales', 'Salesforce'],
    clarificationQuestion: 'Are you looking for CRM tools like HubSpot, Pipedrive, or Zoho CRM?',
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripEdgePunctuation(value: string): string {
  return value
    .replace(/^[`"'“”'‘’]+/, '')
    .replace(/[`"'“”'‘’]+$/, '')
    .replace(/[.,;:!?]+$/g, '');
}

function wordCount(value: string): number {
  if (!value) return 0;
  return value.split(/\s+/).filter(Boolean).length;
}

function includesLongSentenceStructure(value: string): boolean {
  if (!SENTENCE_PATTERN.test(value)) return false;
  return value.length > 35;
}

export function validateVendorTarget(candidate: string): VendorTargetValidation {
  const normalized = stripEdgePunctuation(normalizeWhitespace(candidate));
  if (!normalized) {
    return { valid: false, normalized: '', reason: 'empty vendor target' };
  }

  if (URL_PATTERN.test(normalized)) {
    return { valid: true, normalized };
  }

  if (normalized.length > MAX_VENDOR_LENGTH) {
    return { valid: false, normalized, reason: 'vendor target is too long' };
  }

  if (REQUEST_LEAD_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: 'vendor target looks like a user request sentence' };
  }

  if (BUDGET_LANGUAGE_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: 'vendor target contains budget language' };
  }

  if (includesLongSentenceStructure(normalized)) {
    return { valid: false, normalized, reason: 'vendor target contains sentence punctuation' };
  }

  if (wordCount(normalized) > MAX_VENDOR_WORDS) {
    return { valid: false, normalized, reason: 'vendor target has too many words' };
  }

  return { valid: true, normalized };
}

export function sanitizeVendorTargets(candidates: string[], max = 10): string[] {
  const normalized = candidates
    .map((candidate) => validateVendorTarget(candidate))
    .filter((result) => result.valid)
    .map((result) => result.normalized);

  return Array.from(new Set(normalized)).slice(0, max);
}

export function findInvalidVendorTargets(candidates: string[]): Array<{ target: string; reason: string }> {
  return candidates
    .map((candidate) => {
      const result = validateVendorTarget(candidate);
      if (result.valid) return null;
      return {
        target: candidate,
        reason: result.reason || 'invalid vendor target',
      };
    })
    .filter((row): row is { target: string; reason: string } => Boolean(row));
}

export function deriveVendorCandidatesFromContext(input: {
  goal: string;
  category?: string | null;
  maxCandidates?: number;
}): string[] {
  const goal = normalizeWhitespace(input.goal || '');
  const category = normalizeWhitespace(input.category || '');
  const context = `${category} ${goal}`.trim();

  const matched = VENDOR_HINTS.find((hint) => hint.pattern.test(context));
  if (!matched) return [];

  return sanitizeVendorTargets(matched.vendors, input.maxCandidates || 5);
}

export function buildVendorClarificationQuestion(input: {
  goal: string;
  category?: string | null;
}): string {
  const context = `${input.category || ''} ${input.goal || ''}`.trim();
  const matched = VENDOR_HINTS.find((hint) => hint.pattern.test(context));
  if (matched) return matched.clarificationQuestion;
  return 'Which specific vendors should I compare? Share 2-5 vendor names and I will continue.';
}
