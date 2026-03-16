import type { Variants } from "framer-motion";

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.94 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.08 } },
};

export const staggerSlow: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.15 } },
};

export const hoverLift = {
  whileHover: { y: -4, boxShadow: "0 8px 32px rgba(17,17,17,0.1)" },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

export const viewportOnce = { once: true, margin: "-80px" as const };
