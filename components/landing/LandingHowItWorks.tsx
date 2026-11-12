"use client";

import { motion } from "framer-motion";
import { Layers, BarChart3, TrendingUp, Heart } from "lucide-react";
import { C, sectionHeadingStyle, subtitleStyle } from "./landingConstants";
import { fadeUp, staggerContainer, hoverLift, viewportOnce } from "./landingMotion";

const steps = [
  {
    icon: Layers,
    title: "Connect your accounts",
    desc: "Link your bank accounts and credit cards. Read-only, bank-grade secure.",
    accent: C.apricot,
    bg: C.apricotSoft,
  },
  {
    icon: BarChart3,
    title: "See the full picture",
    desc: "Every transaction categorized. Subscriptions detected. Spending patterns revealed.",
    accent: C.sage,
    bg: C.sageSoft,
  },
  {
    icon: TrendingUp,
    title: "Know what's coming",
    desc: "Bill reminders, spending forecasts, and trend alerts before they surprise you.",
    accent: C.blush,
    bg: C.blushSoft,
  },
  {
    icon: Heart,
    title: "Feel in control",
    desc: "Clear guidance, smart suggestions, and a calm dashboard that puts you first.",
    accent: C.caramel,
    bg: C.apricotSoft,
  },
];

export function LandingHowItWorks() {
  return (
    <section
      id="features"
      className="px-6 py-28 md:px-10"
      style={{ background: C.warmWhite }}
    >
      <div className="mx-auto max-w-[1200px]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="mb-16 text-center"
        >
          <motion.h2 variants={fadeUp} style={sectionHeadingStyle}>
            How Agent Wallet works
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-lg" style={subtitleStyle}>
            From connecting your accounts to acting on insights — in four simple steps.
          </motion.p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="grid grid-cols-1 gap-6 md:grid-cols-4"
        >
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.title}
                variants={fadeUp}
                {...hoverLift}
                className="relative flex flex-col"
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 24,
                  padding: 28,
                  boxShadow: C.shadow,
                  cursor: "default",
                }}
              >
                {/* Connector line (desktop only) */}
                {i < steps.length - 1 && (
                  <div
                    className="absolute -right-3 top-1/2 hidden h-px w-6 md:block"
                    style={{ borderTop: `2px dashed ${C.border}`, zIndex: 3 }}
                  />
                )}

                {/* Step number */}
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: C.cream,
                    border: `1px solid ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.textMuted,
                    marginBottom: 14,
                  }}
                >
                  {i + 1}
                </div>

                {/* Icon */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: step.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <Icon size={22} color={step.accent} />
                </div>

                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: 18,
                    fontWeight: 600,
                    color: C.textPrimary,
                    fontFamily: C.fontFamily,
                    lineHeight: 1.3,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: C.textSecondary }}>
                  {step.desc}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
