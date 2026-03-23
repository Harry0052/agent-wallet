"use client";

import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { C, sectionHeadingStyle } from "./landingConstants";
import { fadeUp, staggerContainer, viewportOnce } from "./landingMotion";
import { StudentSocialProofCarousel } from "./StudentSocialProofCarousel";

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
  {
    quote: "I used to dread looking at my bank account. Now I actually enjoy checking in with Calico every morning.",
    name: "Daniel P.",
    role: "Teacher",
  },
  {
    quote: "The recurring bill detection alone saved me from three duplicate charges I had no idea about.",
    name: "Mei L.",
    role: "Marketing Director",
  },
  {
    quote: "It's like having a financial advisor who actually knows your spending habits. Incredibly intuitive.",
    name: "Chris W.",
    role: "Software Engineer",
  },
  {
    quote: "My partner and I finally stopped arguing about money. Calico makes everything transparent and calm.",
    name: "Priya S.",
    role: "Architect",
  },
  {
    quote: "I've tried every budgeting app out there. Calico is the only one that stuck. It just works.",
    name: "Tomas R.",
    role: "Photographer",
  },
  {
    quote: "The cash flow forecast helped me plan my first real vacation in three years. Thank you, Calico.",
    name: "Aisha B.",
    role: "Nurse",
  },
  {
    quote: "Setup was shockingly fast. Within ten minutes I had a complete picture of where my money goes.",
    name: "Marcus J.",
    role: "Startup Founder",
  },
];

// First 5 testimonials for the marquee row (strongest conversion quotes)
const row1 = testimonials.slice(0, 5);

function TestimonialCard({ t }: { t: (typeof testimonials)[number] }) {
  return (
    <div
      className="calico-marquee-card"
      style={{
        flexShrink: 0,
        width: 340,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 22,
        padding: "26px 28px",
        boxShadow: C.shadow,
        cursor: "default",
        position: "relative",
      }}
    >
      {/* Decorative quote mark */}
      <span
        style={{
          position: "absolute",
          top: 14,
          right: 18,
          fontSize: 48,
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

      <div className="mb-3 flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} size={13} fill={C.apricot} color={C.apricot} style={{ opacity: 0.8 }} />
        ))}
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 14.5,
          lineHeight: 1.65,
          color: C.textSecondary,
          fontStyle: "italic",
          position: "relative",
          zIndex: 1,
          minHeight: 60,
        }}
      >
        &ldquo;{t.quote}&rdquo;
      </p>

      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: C.apricotSoft,
            border: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: C.caramel,
          }}
        >
          {t.name[0]}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>{t.name}</p>
          <p style={{ margin: "1px 0 0", fontSize: 11.5, color: C.textMuted }}>{t.role}</p>
        </div>
      </div>
    </div>
  );
}

function MarqueeRow({
  items,
  direction,
  speed,
}: {
  items: (typeof testimonials);
  direction: "left" | "right";
  speed: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  // We duplicate items 3x to ensure seamless looping
  const duplicated = [...items, ...items, ...items];
  const gap = 20;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Check reduced motion preference
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    let raf: number;
    let offset = 0;
    // Width of one full set (items.length cards + gaps)
    const cardWidth = 340 + gap;
    const setWidth = items.length * cardWidth;

    const animate = () => {
      const delta = direction === "left" ? -speed : speed;
      offset += delta;

      // Seamless loop: reset when one full set has scrolled past
      if (direction === "left" && offset <= -setWidth) {
        offset += setWidth;
      } else if (direction === "right" && offset >= setWidth) {
        offset -= setWidth;
      }

      track.style.transform = `translate3d(${offset}px, 0, 0)`;
      raf = requestAnimationFrame(animate);
    };

    // Start offset for right-direction row so it begins from a different position
    if (direction === "right") {
      offset = -setWidth;
    }

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [direction, speed, items.length]);

  return (
    <div
      className="calico-marquee-row"
      style={{ overflow: "hidden", width: "100%" }}
    >
      <div
        ref={trackRef}
        style={{
          display: "flex",
          gap,
          willChange: "transform",
        }}
      >
        {duplicated.map((t, i) => (
          <TestimonialCard key={`${t.name}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

export function LandingTestimonials() {
  return (
    <section className="py-24" style={{ background: C.cream, overflow: "hidden" }}>
      <div className="mx-auto max-w-[1100px] px-6 md:px-10">
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
      </div>

      {/* Full-bleed marquee — overflow hidden on the section, not constrained by max-width */}
      <MarqueeRow items={row1} direction="left" speed={0.4} />

      {/* Student social proof carousel — replaces second testimonial row */}
      <StudentSocialProofCarousel />
    </section>
  );
}
