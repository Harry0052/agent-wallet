"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Lock, RefreshCw } from "lucide-react";
import { C } from "./landingConstants";
import { fadeUp, staggerContainer, viewportOnce } from "./landingMotion";

export function LandingCta() {
  const [email, setEmail] = useState("");

  return (
    <section
      className="relative overflow-hidden px-6 py-28 md:px-10"
      style={{ background: `linear-gradient(160deg, ${C.cream} 0%, ${C.warmWhite} 100%)` }}
    >
      {/* Decorative glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: C.apricotSoft,
          filter: "blur(80px)",
          opacity: 0.3,
          pointerEvents: "none",
        }}
      />

      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={viewportOnce}
        variants={staggerContainer}
        className="relative z-10 mx-auto max-w-2xl text-center"
      >
        <motion.h2
          variants={fadeUp}
          className="mb-5 font-bold leading-tight"
          style={{
            fontSize: "clamp(2.2rem, 4.5vw, 3rem)",
            fontFamily: C.fontFamily,
            color: C.textPrimary,
            letterSpacing: "-0.02em",
          }}
        >
          Ready to feel better about your money?
        </motion.h2>
        <motion.p variants={fadeUp} className="mx-auto mb-8 max-w-md leading-relaxed" style={{ fontSize: "1.05rem", color: C.textSecondary }}>
          Join thousands of people who finally understand where their money goes.
        </motion.p>

        <motion.form
          variants={fadeUp}
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center"
          onSubmit={(e) => e.preventDefault()}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="h-14 w-full rounded-full px-6 text-sm focus:outline-none sm:w-72"
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary }}
          />
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href={`/signup${email ? `?email=${encodeURIComponent(email)}` : ""}`}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full px-7 text-[0.88rem] font-semibold"
              style={{
                background: C.apricot,
                color: C.charcoal,
                boxShadow: "0 4px 18px rgba(253,186,116,0.38)",
              }}
            >
              Get early access <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        </motion.form>

        <motion.div variants={fadeUp} className="mt-7 flex flex-wrap items-center justify-center gap-4">
          {[
            { icon: CheckCircle2, label: "No credit card required" },
            { icon: RefreshCw, label: "Cancel anytime" },
            { icon: Lock, label: "Bank-grade security" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{label}</span>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
