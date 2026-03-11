import type { DisputeEvidenceObject } from './evidence.ts';

export interface DisputePdfDocument {
  fileName: string;
  mimeType: 'application/pdf';
  bytes: Buffer;
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildLines(evidence: DisputeEvidenceObject): string[] {
  const lines: string[] = [];
  const tx = evidence.transaction;
  lines.push('Agent Wallet Dispute Evidence Summary');
  lines.push(`Generated: ${evidence.generatedAt}`);
  lines.push('');
  lines.push(`Transaction ID: ${tx.id}`);
  lines.push(`Merchant: ${tx.merchantName}`);
  lines.push(`Amount: ${tx.amount.toFixed(2)} ${tx.currency}`);
  lines.push(`Payment Status: ${tx.paymentStatus}`);
  lines.push(`Activation Status: ${tx.activationStatus}`);
  lines.push(`Captured At: ${tx.timestamps.capturedAt || 'N/A'}`);
  lines.push(`Activation Checked At: ${tx.timestamps.activationCheckedAt || 'N/A'}`);
  lines.push('');
  lines.push(`Recommendation: ${evidence.complianceSummary.recommendation}`);
  lines.push(`Confidence: ${evidence.complianceSummary.confidence}`);
  lines.push(`Rationale: ${evidence.complianceSummary.rationale}`);
  lines.push('');
  lines.push(`Proof Service Never Provisioned: ${evidence.proofs.serviceNeverProvisioned.satisfied ? 'YES' : 'NO'}`);
  lines.push(`Proof User Did Not Receive Benefit: ${evidence.proofs.userDidNotReceiveBenefit.satisfied ? 'YES' : 'NO'}`);
  lines.push(`Retry Attempts: ${evidence.retryAttempts.length}`);
  lines.push(`Returned Errors: ${evidence.returnedErrors.length}`);
  lines.push(`Screenshots: ${evidence.screenshots.length}`);
  lines.push('');
  lines.push('Top Errors:');
  for (const err of evidence.returnedErrors.slice(0, 6)) {
    lines.push(`- ${err.source}${err.code ? ` (${err.code})` : ''}: ${err.message}`);
  }
  if (evidence.returnedErrors.length === 0) {
    lines.push('- None recorded');
  }
  lines.push('');
  lines.push('Latest Orchestration Logs:');
  for (const log of evidence.orchestrationLogs.slice(-8)) {
    lines.push(`- [${log.at}] ${log.stage}/${log.status}: ${log.message}`);
  }
  if (evidence.orchestrationLogs.length === 0) {
    lines.push('- None recorded');
  }
  return lines.slice(0, 44);
}

function renderSimplePdf(lines: string[]): Buffer {
  const fontSize = 10;
  const lineHeight = 13;
  const startX = 50;
  const startY = 760;

  const contentLines = [
    'BT',
    `/F1 ${fontSize} Tf`,
    `${startX} ${startY} Td`,
  ];

  lines.forEach((line, index) => {
    if (index > 0) {
      contentLines.push(`0 -${lineHeight} Td`);
    }
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });

  contentLines.push('ET');
  const streamBody = `${contentLines.join('\n')}\n`;

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${Buffer.byteLength(streamBody, 'utf8')} >> stream\n${streamBody}endstream endobj\n`,
  ];

  let body = '';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(`%PDF-1.4\n${body}`, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    const absoluteOffset = offsets[i] + Buffer.byteLength('%PDF-1.4\n', 'utf8');
    xref += `${String(absoluteOffset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = [
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  return Buffer.from(`%PDF-1.4\n${body}${xref}${trailer}`, 'utf8');
}

export function generateDisputeEvidencePdf(evidence: DisputeEvidenceObject): DisputePdfDocument {
  const lines = buildLines(evidence);
  const bytes = renderSimplePdf(lines);
  const safeTxId = evidence.transaction.id.replace(/[^a-zA-Z0-9._-]+/g, '_');

  return {
    fileName: `dispute-evidence-${safeTxId}.pdf`,
    mimeType: 'application/pdf',
    bytes,
  };
}
