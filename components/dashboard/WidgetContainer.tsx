import type { ComponentProps, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WidgetHeader } from "@/components/dashboard/WidgetHeader";
import { dashboardHoverShadow, dashboardSurfaceStyle } from "@/components/dashboard/dashboardStyles";

interface WidgetContainerProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dragHandleProps?: ComponentProps<typeof WidgetHeader>["dragHandleProps"];
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function WidgetContainer({
  title,
  subtitle,
  action,
  dragHandleProps,
  children,
  className,
  contentClassName,
}: WidgetContainerProps) {
  return (
    <motion.section
      layout
      whileHover={{ y: -1, boxShadow: dashboardHoverShadow }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={dashboardSurfaceStyle}
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 md:p-6",
        className,
      )}
    >
      <div className="relative z-10 flex h-full flex-col">
        <WidgetHeader title={title} subtitle={subtitle} action={action} dragHandleProps={dragHandleProps} />
        <div className={cn("mt-4 flex-1", contentClassName)}>{children}</div>
      </div>
    </motion.section>
  );
}
