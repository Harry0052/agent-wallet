"use client";

import { motion } from "framer-motion";
import { Eye, Lock, ShieldCheck, CheckCircle2 } from "lucide-react";
import { C, sectionHeadingStyle, subtitleStyle } from "./landingConstants";
import { fadeUp, staggerContainer, hoverLift, viewportOnce } from "./landingMotion";

const cards = [
  { icon: Eye, title: "Read-only access", desc: "We never move your money. We only read what you share.", bg: C.apricotSoft, accent: C.apricot },
  { icon: Lock, title: "Bank-grade encryption", desc: "AES-256 encryption at rest and in transit, always.", bg: C.sageSoft, accent: C.sage },
  { icon: ShieldCheck, title: "You control what we see", desc: "Connect, disconnect, and audit any connection at any time.", bg: C.blushSoft, accent: C.blush },
  { icon: CheckCircle2, title: "Zero data sold", desc: "Your financial data is never sold, shared, or monetized.", bg: C.apricotSoft, accent: C.caramel },
];

export function LandingTrust() {
  return (
    <section id="trust" className="px-6 py-24 md:px-10" style={{ background: C.warmWhite }}>
      <div className="mx-auto max-w-[1100px]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="mb-14 text-center"
        >
          <motion.h2 variants={fadeUp} style={sectionHeadingStyle}>
            Your data stays yours.
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-lg" style={subtitleStyle}>
            We built Agent Wallet with security and privacy at the core.
          </motion.p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <motion.div
                key={c.title}
                variants={fadeUp}
                {...hoverLift}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 24,
                  padding: 32,
                  boxShadow: C.shadow,
                  cursor: "default",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    background: c.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <Icon size={22} color={c.accent} />
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: C.textPrimary, fontFamily: C.fontFamily, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                  {c.title}
                </h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: C.textSecondary }}>
                  {c.desc}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
