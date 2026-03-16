"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Sparkles, Zap } from "lucide-react";
import { startCheckout, type PlanId } from "@/services/billing";

const plans: {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  desc: string;
  badge?: string;
  icon: typeof Sparkles;
  iconColor: string;
  features: string[];
  highlight: boolean;
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$8.99",
    period: "/month",
    desc: "14-day free trial. The essentials to understand your money.",
    icon: Sparkles,
    iconColor: "#FDBA74",
    features: [
      "Connect up to 3 accounts",
      "See all transactions",
      "Basic spending insights",
      "Recurring bill detection",
      "Monthly summaries",
    ],
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29.99",
    period: "/month",
    badge: "Most Popular",
    desc: "Smarter money management with deeper intelligence.",
    icon: Zap,
    iconColor: "#FDBA74",
    features: [
      "Everything in Starter",
      "Unlimited accounts",
      "Smart savings suggestions",
      "Spending trend analysis",
      "Cash flow forecasting",
      "Custom categories",
      "Priority support",
    ],
    highlight: true,
  },
  {
    id: "autonomous",
    name: "Autonomous",
    price: "$89.99",
    period: "/month",
    desc: "Full AI-powered automation. Calico does it for you.",
    icon: Crown,
    iconColor: "#FDBA74",
    features: [
      "Everything in Pro",
      "AI-powered automation",
      "Autonomous bill negotiation",
      "Advanced cash flow forecasting",
      "Financial memory",
      "Custom integrations",
      "API access",
    ],
    highlight: false,
  },
];

const easeOut: [number, number, number, number] = [0.16, 0.7, 0.2, 1];

const containerVariants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.1, delayChildren: 0.25 },
  },
};

const cardVariants = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: easeOut },
  },
};

export function PlanSelection() {
  const [loading, setLoading] = useState<PlanId | null>(null);

  const handleSelect = async (planId: PlanId) => {
    setLoading(planId);
    try {
      await startCheckout(planId);
    } catch {
      setLoading(null);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #FFF7ED 0%, #FFFCF8 100%)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="mb-4 flex items-center gap-2"
      >
        <img src="/calico-icon.png" alt="Calico" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif" }}>
          Calico
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.45, ease: [0.16, 0.7, 0.2, 1] }}
        className="mb-3 text-center"
        style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.15 }}
      >
        Choose your plan
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="mb-10 max-w-md text-center"
        style={{ fontSize: 15, color: "#3A332E", lineHeight: 1.65 }}
      >
        Pick the plan that fits your financial life. You can upgrade or change anytime.
      </motion.p>

      <motion.div
        variants={containerVariants}
        initial="initial"
        animate="animate"
        className="grid w-full max-w-4xl grid-cols-1 items-stretch gap-5 md:grid-cols-3"
      >
        {plans.map((plan) => {
          const Icon = plan.icon;
          return (
            <motion.div
              key={plan.id}
              variants={cardVariants}
              whileHover={{ y: -4, boxShadow: plan.highlight ? "0 12px 40px rgba(253,186,116,0.28)" : "0 8px 28px rgba(17,17,17,0.1)" }}
              className="relative flex flex-col"
              style={{
                background: plan.highlight ? "rgba(253,186,116,0.12)" : "#FFFCF8",
                border: plan.highlight ? "2px solid #FDBA74" : "1px solid #F2DECC",
                borderRadius: 24,
                padding: 28,
                boxShadow: plan.highlight
                  ? "0 8px 32px rgba(253,186,116,0.2)"
                  : "0 2px 12px rgba(17,17,17,0.06)",
                transform: plan.highlight ? "scale(1.02)" : undefined,
                zIndex: plan.highlight ? 2 : 1,
                transition: "box-shadow 0.25s ease, transform 0.25s ease",
              }}
            >
              {plan.badge && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                  style={{ background: "#FDBA74", color: "#111", boxShadow: "0 2px 8px rgba(253,186,116,0.35)" }}
                >
                  {plan.badge}
                </span>
              )}

              <div className="mb-5 flex items-center gap-3">
                <div
                  style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(253,186,116,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Icon size={20} color={plan.iconColor} />
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif" }}>
                  {plan.name}
                </span>
              </div>

              <div className="mb-1 flex items-baseline gap-1">
                <span style={{ fontSize: 36, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif", lineHeight: 1 }}>
                  {plan.price}
                </span>
                <span style={{ fontSize: 14, color: "#6B5B4B" }}>{plan.period}</span>
              </div>
              <p className="mb-5" style={{ fontSize: 13, color: "#6B5B4B", lineHeight: 1.5 }}>
                {plan.desc}
              </p>

              <ul className="flex-1" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2" style={{ fontSize: 13, color: "#3A332E" }}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "#FDBA74" }} />
                    {f}
                  </li>
                ))}
              </ul>

              <motion.button
                type="button"
                onClick={() => void handleSelect(plan.id)}
                disabled={loading !== null}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
                className="mt-7 w-full rounded-full py-3 text-sm font-semibold"
                style={
                  plan.highlight
                    ? { background: "#FDBA74", color: "#111", boxShadow: "0 4px 16px rgba(253,186,116,0.38)" }
                    : { background: "#FFFCF8", border: "1.5px solid #F2DECC", color: "#3A332E" }
                }
              >
                {loading === plan.id
                  ? "Redirecting to checkout..."
                  : plan.id === "starter"
                    ? "Start 14-day free trial"
                    : `Subscribe to ${plan.name}`}
              </motion.button>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
