import type { CandidateSourcingTaskRecord } from '../server/sourcingTaskStore.ts';

export interface SourcingDashboardCard {
  id: string;
  status: string;
  intent: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  summary: string | null;
  sheetUrl: string | null;
  shortlistCount: number;
  shortlistPreview: Array<{
    fullName: string;
    currentTitle: string;
    location: string;
    score: number;
    sourceUrl: string;
  }>;
}

export function toSourcingDashboardCard(task: CandidateSourcingTaskRecord): SourcingDashboardCard {
  const shortlist = task.result?.shortlist || [];

  return {
    id: task.id,
    status: task.status,
    intent: task.intent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    error: task.error,
    summary: task.result?.summary || null,
    sheetUrl: task.result?.export?.sheetUrl || null,
    shortlistCount: shortlist.length,
    shortlistPreview: shortlist.slice(0, 3).map((candidate) => ({
      fullName: candidate.fullName,
      currentTitle: candidate.currentTitle,
      location: candidate.location,
      score: candidate.score,
      sourceUrl: candidate.sourceUrl,
    })),
  };
}
