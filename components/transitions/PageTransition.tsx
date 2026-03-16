"use client";

import { motion } from "framer-motion";
import type { TargetAndTransition } from "framer-motion";
import type { ReactNode } from "react";

type Variant = "fade" | "rise" | "scale" | "reveal" | "slide";

type EaseTuple = [number, number, number, number];

const variants: Record<Variant, { initial: TargetAndTransition; animate: TargetAndTransition }> = {
  fade: {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
  },
  rise: {
    initial: { opacity: 0, y: 24, scale: 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
  },
  reveal: {
    initial: { opacity: 0, scale: 0.98, filter: "blur(6px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  },
  slide: {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
  },
};

const easings: Record<Variant, EaseTuple> = {
  fade: [0.25, 0.46, 0.45, 0.94],
  rise: [0.16, 0.7, 0.2, 1],
  scale: [0.25, 0.46, 0.45, 0.94],
  reveal: [0.16, 0.7, 0.2, 1],
  slide: [0.25, 0.46, 0.45, 0.94],
};

const durations: Record<Variant, number> = {
  fade: 0.35,
  rise: 0.45,
  scale: 0.4,
  reveal: 0.55,
  slide: 0.3,
};

interface PageTransitionProps {
  children: ReactNode;
  variant?: Variant;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PageTransition({
  children,
  variant = "fade",
  delay = 0,
  className,
  style,
}: PageTransitionProps) {
  const v = variants[variant];
  const ease = easings[variant];
  const duration = durations[variant];

  return (
    <motion.div
      initial={v.initial}
      animate={v.animate}
      transition={{ duration, ease, delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: ReactNode;
  stagger?: number;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function StaggerReveal({
  children,
  stagger = 0.07,
  delay = 0,
  className,
  style,
}: StaggerProps) {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{
        initial: {},
        animate: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

const staggerChildEase: EaseTuple = [0.25, 0.46, 0.45, 0.94];

export function StaggerChild({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 16 },
        animate: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: staggerChildEase },
        },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
