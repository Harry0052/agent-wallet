export function buildTalentSourcingResponse(sheetUrl: string): string {
  return [
    "Task completed.",
    "",
    "Top 3 candidates sourced from Indeed.",
    "",
    "View shortlist:",
    sheetUrl,
  ].join("\n");
}
