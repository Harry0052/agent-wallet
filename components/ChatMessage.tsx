'use client';

import { ChatMessage as Msg, OptionsData, ApprovalData, ReceiptData, AgentLogData, FundingData } from '@/lib/types';
import { useApp } from '@/lib/store';
import { fmt, fmtTime, cn } from '@/lib/utils';

// ── Inline components for special message types ────────────

function OptionCards({ data }: { data: OptionsData }) {
  const { selectOption } = useApp();

  return (
    <div className="space-y-2 mt-2">
      {data.options.map((opt) => {
        const isRec = opt.id === data.recommendedId;
        return (
          <button
            key={opt.id}
            onClick={() => selectOption(opt)}
            className={cn(
              'w-full text-left p-3 rounded-lg border transition-all',
              isRec
                ? 'bg-green-600/10 border-green-600/50 hover:bg-green-600/20'
                : 'bg-gray-700/30 border-gray-600/30 hover:bg-gray-700/50',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">{opt.name}</span>
                  {isRec && (
                    <span className="text-[10px] uppercase tracking-wider bg-green-600/30 text-green-300 px-1.5 py-0.5 rounded">
                      Best Match
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{opt.item}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  {opt.distance && <span>{opt.distance}</span>}
                  {opt.rating && <span>{'*'.repeat(Math.round(opt.rating))} {opt.rating}</span>}
                  {opt.tags && opt.tags.slice(0, 2).map((t) => (
                    <span key={t} className="text-gray-500">{t}</span>
                  ))}
                </div>
              </div>
              <p className="text-lg font-bold text-white whitespace-nowrap">{fmt(opt.price)}</p>
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
    <div className="mt-2 bg-yellow-600/10 border border-yellow-600/40 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-white text-sm">{data.merchant}</p>
          <p className="text-xs text-gray-400">{data.item}</p>
        </div>
        <p className="text-xl font-bold text-white">{fmt(data.amount)}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => approveTask(data.taskId)}
          className="flex-1 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-semibold text-white transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => rejectTask(data.taskId)}
          className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-300 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ReceiptCard({ data }: { data: ReceiptData }) {
  return (
    <div className="mt-2 bg-green-600/10 border border-green-600/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-white text-sm">{data.merchant}</p>
          <p className="text-xs text-gray-400">{data.item}</p>
        </div>
        <p className="text-lg font-bold text-green-300">-{fmt(data.amount)}</p>
      </div>
      <div className="border-t border-green-600/30 pt-2 space-y-1 text-xs">
        <div className="flex justify-between text-gray-400">
          <span>Previous balance</span>
          <span>{fmt(data.previousBalance)}</span>
        </div>
        <div className="flex justify-between text-white font-medium">
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
    <div className="mt-2 bg-blue-600/10 border border-blue-600/40 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-white text-sm">Wallet top-up</p>
          <p className="text-xs text-gray-400">Stripe checkout with Apple Pay support</p>
        </div>
        <p className="text-xl font-bold text-white">{fmt(data.amount)}</p>
      </div>
      <button
        onClick={() => void startFunding(data.amount)}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold text-white transition-colors"
      >
        Continue to Stripe
      </button>
    </div>
  );
}

function AgentLog({ data }: { data: AgentLogData }) {
  const icons: Record<string, string> = {
    search: 'Search', visit: 'Visit', extract: 'Extract', compare: 'Compare',
    select: 'Select', checkout: 'Checkout', 'form-fill': 'Form', confirm: 'Confirm', plan: 'Plan', guardrail: 'Guardrail', payment: 'Payment',
  };

  return (
    <div className="mt-2 space-y-1.5 text-xs border-l-2 border-blue-600/40 pl-3">
      {data.steps.map((s) => (
        <div key={s.id} className="flex items-start gap-2 text-gray-400">
          <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-gray-500 min-w-[56px]">
            {icons[s.type] || 'Step'}
          </span>
          <span className="flex-1">{s.description}</span>
        </div>
      ))}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
      <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
      <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function ChatMessageBubble({ message }: { message: Msg }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-gray-800 text-gray-100 rounded-bl-md border border-gray-700/50',
        )}
      >
        {/* Text content — render bold markdown */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
              : part
          )}
        </p>

        {/* Special content */}
        {message.type === 'thinking' && <ThinkingIndicator />}
        {message.type === 'options' && message.data && <OptionCards data={message.data as OptionsData} />}
        {message.type === 'approval' && message.data && <ApprovalCard data={message.data as ApprovalData} />}
        {message.type === 'receipt' && message.data && <ReceiptCard data={message.data as ReceiptData} />}
        {message.type === 'funding' && message.data && <FundingCard data={message.data as FundingData} />}
        {message.type === 'agent-log' && message.data && <AgentLog data={message.data as AgentLogData} />}

        {/* Timestamp */}
        <p className={cn('text-[10px] mt-1', isUser ? 'text-blue-200' : 'text-gray-500')}>
          {fmtTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
