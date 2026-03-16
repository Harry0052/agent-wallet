"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { C, sectionHeadingStyle, subtitleStyle } from "./landingConstants";
import { fadeUp, staggerContainer, viewportOnce } from "./landingMotion";

const plans = [
  {
    name: "Starter",
    price: "$8.99",
    period: "/month",
    desc: "14-day free trial included",
    features: [
      "Connect up to 3 accounts",
      "See all transactions",
      "Basic spending insights",
      "Recurring bill detection",
      "Monthly summaries",
    ],
    cta: "Start Free Trial",
    href: "/signup?plan=starter",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29.99",
    period: "/month",
    desc: "Everything, unlimited",
    badge: "Most Popular",
    features: [
      "Everything in Starter",
      "Unlimited accounts",
      "Smart savings suggestions",
      "Spending trend analysis",
      "Custom categories",
      "Priority support",
    ],
    cta: "Subscribe to Pro",
    href: "/signup?plan=pro",
    highlighted: true,
  },
  {
    name: "Autonomous",
    price: "$89.99",
    period: "/month",
    desc: "Full AI-powered automation",
    features: [
      "Everything in Pro",
      "AI-powered automation",
      "Autonomous bill negotiation",
      "Advanced cash flow forecasting",
      "Dedicated account manager",
      "Custom integrations",
      "API access",
    ],
    cta: "Subscribe to Autonomous",
    href: "/signup?plan=autonomous",
    highlighted: false,
  },
];

export function LandingPricing() {
  return (
    <section id="pricing" className="px-6 py-28 md:px-10" style={{ background: C.warmWhite }}>
      <div className="mx-auto max-w-[1100px]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="mb-14 text-center"
        >
          <motion.h2 variants={fadeUp} style={sectionHeadingStyle}>
            Simple, honest pricing.
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-lg" style={subtitleStyle}>
            Start with a 14-day free trial on Starter. Upgrade anytime.
          </motion.p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3"
        >
          {plans.map((plan) => (
            <motion.div
              key={plan.name}
              variants={fadeUp}
              whileHover={{ y: -4, boxShadow: "0 8px 32px rgba(17,17,17,0.1)" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative flex flex-col"
              style={{
                background: plan.highlighted ? C.apricotSoft : C.surface,
                border: plan.highlighted ? `2px solid ${C.apricot}` : `1px solid ${C.border}`,
                borderRadius: 24,
                padding: 32,
                boxShadow: plan.highlighted ? "0 8px 32px rgba(253,186,116,0.28)" : C.shadow,
                transform: plan.highlighted ? "scale(1.03)" : undefined,
                zIndex: plan.highlighted ? 2 : 1,
                cursor: "default",
              }}
            >
              {plan.badge && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.1em]"
                  style={{
                    background: C.apricot,
                    color: C.charcoal,
                    boxShadow: "0 2px 8px rgba(253,186,116,0.35)",
                  }}
                >
                  {plan.badge}
                </span>
              )}

              <div className="mb-6">
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.textPrimary, fontFamily: C.fontFamily }}>
                  {plan.name}
                </p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span style={{ fontSize: 40, fontWeight: 700, color: C.textPrimary, fontFamily: C.fontFamily, lineHeight: 1 }}>
                    {plan.price}
                  </span>
                  <span style={{ fontSize: 14, color: C.textMuted }}>{plan.period}</span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: C.textMuted }}>{plan.desc}</p>
              </div>

              <ul className="flex-1" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5" style={{ fontSize: 14, color: C.textSecondary }}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: C.apricot }} />
                    {feat}
                  </li>
                ))}
              </ul>

              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="mt-8">
                <Link
                  href={plan.href}
                  className="inline-flex w-full items-center justify-center rounded-full px-4 py-3.5 text-[0.88rem] font-semibold transition-all"
                  style={
                    plan.highlighted
                      ? {
                          background: C.apricot,
                          color: C.charcoal,
                          boxShadow: "0 4px 16px rgba(253,186,116,0.38)",
                        }
                      : {
                          background: C.surface,
                          border: `1.5px solid ${C.border}`,
                          color: C.textSecondary,
                        }
                  }
                >
                  {plan.cta}
                </Link>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
