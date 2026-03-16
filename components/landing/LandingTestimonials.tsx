"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { C, sectionHeadingStyle } from "./landingConstants";
import { fadeUp, staggerContainer, hoverLift, viewportOnce } from "./landingMotion";

const testimonials = [
  {
    quote: "Calico found $340/year I was losing to forgotten subscriptions. It took five minutes to set up.",
    name: "Sarah M.",
    role: "Product Manager",
  },
  {
    quote: "I finally understand my finances without spreadsheets. Calico just shows me what matters.",
    name: "James T.",
    role: "Freelancer",
  },
  {
    quote: "This is what a money app should feel like. Calm, clear, and genuinely helpful.",
    name: "Rachel K.",
    role: "Small Business Owner",
  },
];

export function LandingTestimonials() {
  return (
    <section className="px-6 py-24 md:px-10" style={{ background: C.cream }}>
      <div className="mx-auto max-w-[1100px]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="mb-14 text-center"
        >
          <motion.h2 variants={fadeUp} style={sectionHeadingStyle}>
            People love Calico.
          </motion.h2>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="grid grid-cols-1 gap-5 md:grid-cols-3"
        >
          {testimonials.map((t) => (
            <motion.div
              key={t.name}
              variants={fadeUp}
              {...hoverLift}
              className="relative"
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 24,
                padding: 32,
                boxShadow: C.shadow,
                cursor: "default",
              }}
            >
              {/* Decorative quote */}
              <span
                style={{
                  position: "absolute",
                  top: 16,
                  right: 20,
                  fontSize: 56,
                  fontWeight: 700,
                  color: C.apricotSoft,
                  lineHeight: 1,
                  fontFamily: "Georgia, serif",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                &ldquo;
              </span>

              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={14} fill={C.apricot} color={C.apricot} style={{ opacity: 0.8 }} />
                ))}
              </div>

              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: C.textSecondary, fontStyle: "italic", position: "relative", zIndex: 1 }}>
                &ldquo;{t.quote}&rdquo;
              </p>

              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    background: C.apricotSoft,
                    border: `1px solid ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    fontWeight: 700,
                    color: C.caramel,
                  }}
                >
                  {t.name[0]}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{t.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: C.textMuted }}>{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
