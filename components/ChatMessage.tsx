'use client';

import { ChatMessage as Msg, OptionsData, ApprovalData, ReceiptData, AgentLogData, FundingData, EvidenceData, TaskProgressData, TaskState } from '@/lib/types';
import { useApp } from '@/lib/store';
import { fmt, fmtTime, cn, domainFromUrl } from '@/lib/utils';

function OptionCards({ data }: { data: OptionsData }) {
  const { selectOption } = useApp();

  return (
    <div className="space-y-2.5 mt-3">
      {data.options.map((option) => {
        const recommended = option.id === data.recommendedId;
        return (
          <button
            key={option.id}
            onClick={() => selectOption(option)}
            className={cn(
              'w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-200',
              recommended
                ? 'border-[rgba(201,165,106,0.7)] bg-[rgba(201,165,106,0.14)] shadow-[0_10px_24px_rgba(201,165,106,0.18)]'
                : 'border-[var(--aw-border)] bg-black/15 hover:border-[var(--aw-border-strong)] hover:bg-white/[0.04]'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[var(--aw-text)]">{option.name}</span>
                  {recommended && (
                    <span className="rounded-full border border-[rgba(201,165,106,0.6)] bg-[rgba(201,165,106,0.22)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#e6cb9d]">
                      Best Match
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-[var(--aw-text-soft)]">{option.item}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--aw-text-muted)] flex-wrap">
                  {option.distance && <span>{option.distance}</span>}
                  {option.rating && <span>{option.rating.toFixed(1)} rating</span>}
                  {option.tags && option.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--aw-border)] px-1.5 py-0.5">{tag}</span>
                  ))}
                </div>
              </div>
              <p className="text-base font-semibold text-[#ecd8b4] whitespace-nowrap">{fmt(option.price)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ApprovalCard({ data }: { data: ApprovalData }) {
  const { approveTask, rejectTask } = useApp();

  return (
    <div className="mt-3 rounded-2xl border border-[rgba(201,165,106,0.56)] bg-[rgba(201,165,106,0.13)] p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--aw-text)] truncate">{data.merchant}</p>
          <p className="text-xs text-[var(--aw-text-soft)] truncate">{data.item}</p>
        </div>
        <p className="text-lg font-semibold text-[#ecd8b4]">{fmt(data.amount)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => approveTask(data.taskId)}
          className="aw-button-primary py-2 text-xs"
        >
          Approve
        </button>
        <button
          onClick={() => rejectTask(data.taskId)}
          className="aw-button-secondary py-2 text-xs"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ReceiptCard({ data }: { data: ReceiptData }) {
  return (
    <div className="mt-3 rounded-2xl border border-[rgba(88,166,132,0.6)] bg-[rgba(88,166,132,0.14)] p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--aw-text)] truncate">{data.merchant}</p>
          <p className="text-xs text-[var(--aw-text-soft)] truncate">{data.item}</p>
        </div>
        <p className="text-sm font-semibold text-[#9cd0ba]">-{fmt(data.amount)}</p>
      </div>
      <div className="space-y-1 border-t border-[rgba(88,166,132,0.45)] pt-2 text-xs">
        <div className="flex justify-between text-[var(--aw-text-soft)]">
          <span>Previous balance</span>
          <span>{fmt(data.previousBalance)}</span>
        </div>
        <div className="flex justify-between text-[var(--aw-text)] font-medium">
          <span>New balance</span>
          <span>{fmt(data.newBalance)}</span>
        </div>
      </div>
    </div>
  );
}

function FundingCard({ data }: { data: FundingData }) {
  const { startFunding } = useApp();

  return (
    <div className="mt-3 rounded-2xl border border-[rgba(201,165,106,0.5)] bg-[rgba(201,165,106,0.1)] p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--aw-text)]">Wallet Top-Up</p>
          <p className="text-xs text-[var(--aw-text-soft)]">Stripe Checkout (Apple Pay if enabled)</p>
        </div>
        <p className="text-lg font-semibold text-[#ecd8b4]">{fmt(data.amount)}</p>
      </div>
      <button
        onClick={() => void startFunding(data.amount)}
        className="aw-button-primary w-full py-2 text-sm"
      >
        Continue To Stripe
      </button>
    </div>
  );
}

function AgentLog({ data }: { data: AgentLogData }) {
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-[var(--aw-border)] bg-black/20 p-3">
      {data.steps.map((step) => (
        <div key={step.id} className="flex items-start gap-2">
          <span
            className={cn(
              'mt-1 h-2 w-2 rounded-full',
              step.status === 'error' ? 'bg-[var(--aw-danger)]' : step.status === 'done' ? 'bg-[var(--aw-success)]' : 'aw-dot-live'
            )}
          />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">{step.type}</p>
            <p className="text-xs text-[var(--aw-text-soft)] leading-5">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidencePanel({ data }: { data: EvidenceData }) {
  return (
    <div className="mt-3 space-y-2">
      {data.findings.slice(0, 4).map((finding, index) => {
        const features = Array.isArray(finding.keyFeatures) ? finding.keyFeatures : [];
        return (
          <div key={`${finding.vendorName}_${finding.planName}_${finding.extractedAt}_${index}`} className="rounded-xl border border-[var(--aw-border)] bg-black/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                {domainFromUrl(finding.sourceUrl) || 'source'}
              </p>
              <p className="text-xs text-[#e7d0a8]">{fmt(finding.price)} / {finding.billingFrequency}</p>
            </div>
            <p className="mt-1 text-sm font-semibold text-[var(--aw-text)]">{finding.vendorName} · {finding.planName}</p>
            {features.length > 0 && (
              <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{features.slice(0, 2).join(' • ')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const STATE_STYLES: Record<TaskState, { dot: string; label: string }> = {
  received: { dot: 'bg-[var(--aw-text-muted)]', label: 'Received' },
  parsing: { dot: 'bg-[#dfc08a] animate-pulse', label: 'Parsing' },
  needs_clarification: { dot: 'bg-[#e6a23c]', label: 'Needs Info' },
  resolving_recipient: { dot: 'bg-[#dfc08a] animate-pulse', label: 'Resolving' },
  ready_to_execute: { dot: 'bg-[#67c4a0]', label: 'Ready' },
  executing: { dot: 'aw-dot-live', label: 'Executing' },
  awaiting_approval: { dot: 'bg-[#e6a23c]', label: 'Awaiting Approval' },
  completed: { dot: 'bg-[var(--aw-success)]', label: 'Completed' },
  failed: { dot: 'bg-[var(--aw-danger)]', label: 'Failed' },
};

function TaskProgressPanel({ data }: { data: TaskProgressData }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-2xl border border-[var(--aw-border)] bg-black/20 p-3">
      {data.stateHistory.map((entry, index) => {
        const style = STATE_STYLES[entry.state] || STATE_STYLES.received;
        const isLast = index === data.stateHistory.length - 1;
        return (
          <div key={`${entry.state}-${index}`} className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', style.dot)} />
            <span className={cn(
              'text-xs',
              isLast ? 'text-[var(--aw-text)] font-medium' : 'text-[var(--aw-text-muted)]',
            )}>
              {entry.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <div className="h-1.5 w-1.5 rounded-full bg-[#dfc08a] animate-pulse" />
      <div className="h-1.5 w-1.5 rounded-full bg-[#dfc08a] animate-pulse" style={{ animationDelay: '0.2s' }} />
      <div className="h-1.5 w-1.5 rounded-full bg-[#dfc08a] animate-pulse" style={{ animationDelay: '0.4s' }} />
    </div>
  );
}

function renderMessageText(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index} className="font-semibold text-[#f5dfb6]">{part.slice(2, -2)}</strong>
      : part
  ));
}

export function ChatMessageBubble({ message }: { message: Msg }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <article
        className={cn(
          'max-w-[90%] rounded-[20px] border px-4 py-3 md:max-w-[85%]',
          isUser
            ? 'border-[rgba(201,165,106,0.56)] bg-[linear-gradient(145deg,rgba(201,165,106,0.24),rgba(201,165,106,0.08))] text-[var(--aw-text)]'
            : 'border-[var(--aw-border)] bg-black/20 text-[var(--aw-text)]'
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {renderMessageText(message.content)}
        </p>

        {message.type === 'thinking' && <ThinkingIndicator />}
        {message.type === 'options' && message.data && <OptionCards data={message.data as OptionsData} />}
        {message.type === 'approval' && message.data && <ApprovalCard data={message.data as ApprovalData} />}
        {message.type === 'receipt' && message.data && <ReceiptCard data={message.data as ReceiptData} />}
        {message.type === 'funding' && message.data && <FundingCard data={message.data as FundingData} />}
        {message.type === 'agent-log' && message.data && <AgentLog data={message.data as AgentLogData} />}
        {message.type === 'evidence' && message.data && <EvidencePanel data={message.data as EvidenceData} />}
        {message.type === 'task-progress' && message.data && <TaskProgressPanel data={message.data as TaskProgressData} />}

        <p className={cn('mt-1.5 text-[10px]', isUser ? 'text-[#ead7b6]' : 'text-[var(--aw-text-muted)]')}>
          {fmtTime(message.timestamp)}
        </p>
      </article>
    </div>
  );
}
