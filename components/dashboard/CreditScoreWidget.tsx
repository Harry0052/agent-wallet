import type { HTMLAttributes } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle, dashboardSecondaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function CreditScoreWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  return (
    <WidgetContainer
      title="Credit Score"
      subtitle="Future-ready for bureau integrations."
      dragHandleProps={props.dragHandleProps}
    >
      <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
        <div>
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(34,197,94,0.12)] text-[var(--calico-success)]">
            <ShieldCheck size={20} />
          </div>
          <p className="mt-4 text-lg font-semibold text-[var(--calico-text)]">Turn on credit score tracking</p>
          <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">
            Enable credit score monitoring so this card can surface score changes, utilization, and report updates.
          </p>
        </div>
        <Link
          href="/settings"
          style={dashboardSecondaryButtonStyle}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-card)]"
        >
          Enable credit score
        </Link>
      </div>
    </WidgetContainer>
  );
}
