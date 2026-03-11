import type { NormalizedSourcingRequest, StructuredCandidate } from './schemas.ts';

export function formatShortlistRows(input: {
  request: NormalizedSourcingRequest;
  shortlist: StructuredCandidate[];
}): Array<Array<string | number>> {
  const header = [
    'Rank',
    'Name',
    'Title',
    'Location',
    'Seniority',
    'Skills',
    'Experience',
    'Profile URL',
    'Score',
    'Match Reasons',
    'Notes',
  ];

  const rows = input.shortlist.map((candidate, index) => ([
    index + 1,
    candidate.fullName,
    candidate.currentTitle,
    candidate.location,
    candidate.seniorityLevel,
    candidate.skills.slice(0, 8).join(', '),
    candidate.yearsExperience === null ? 'N/A' : `${candidate.yearsExperience} years`,
    candidate.sourceUrl,
    candidate.score,
    candidate.matchReasons.join(' | '),
    candidate.risks.join(' | '),
  ]));

  return [
    header,
    ...rows,
  ];
}
