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
      whileHover={{ y: -2, boxShadow: dashboardHoverShadow }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={dashboardSurfaceStyle}
      className={cn(
        "relative overflow-hidden rounded-[20px] p-6 transition",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,207,232,0.12),transparent_34%)]" />
      <div className="relative z-10 flex h-full flex-col">
        <WidgetHeader title={title} subtitle={subtitle} action={action} dragHandleProps={dragHandleProps} />
        <div className={cn("mt-5 flex-1", contentClassName)}>{children}</div>
      </div>
    </motion.section>
  );
}
