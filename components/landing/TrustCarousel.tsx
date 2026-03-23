"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { C } from "./landingConstants";
import { fadeUp, viewportOnce } from "./landingMotion";

/* ── Partner data ────────────────────────────────────────────── */

interface Partner {
  src: string;
  alt: string;
  caption: string;
  /** Normalized display height for visual balance */
  height: number;
}

const partners: Partner[] = [
  { src: "/logos/plaid.png", alt: "Plaid logo", caption: "Partnered with Plaid", height: 40 },
  { src: "/logos/stripe.png", alt: "Stripe logo", caption: "Partnered with Stripe", height: 40 },
  { src: "/logos/google.png", alt: "Google logo", caption: "Partnered with Google", height: 40 },
  { src: "/logos/claude.png", alt: "Claude logo", caption: "Partnered with Claude", height: 40 },
];

/* ── Single partner item ─────────────────────────────────────── */

function PartnerItem({ partner }: { partner: Partner }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "0 56px",
        flexShrink: 0,
      }}
    >
      <Image
        src={partner.src}
        alt={partner.alt}
        width={Math.round(partner.height * 3.2)}
        height={partner.height}
        style={{
          height: partner.height,
          width: "auto",
          objectFit: "contain",
          opacity: 0.92,
          userSelect: "none",
          pointerEvents: "none",
        }}
        draggable={false}
        unoptimized
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: C.textSecondary,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          fontFamily: C.fontFamily,
        }}
      >
        {partner.caption}
      </span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export function TrustCarousel() {
  // 4x duplication ensures seamless looping with no gap at any viewport width
  const items = [...partners, ...partners, ...partners, ...partners];

  return (
    <section
      aria-label="Trusted partners"
      style={{
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Trust headline */}
      <motion.p
        variants={fadeUp}
        initial="initial"
        whileInView="animate"
        viewport={viewportOnce}
        style={{
          textAlign: "center",
          fontSize: 11,
          fontWeight: 600,
          color: C.textMuted,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          margin: 0,
          paddingTop: 24,
          fontFamily: C.fontFamily,
        }}
      >
        Trusted infrastructure used by millions
      </motion.p>

      {/* Marquee container */}
      <div
        style={{
          padding: "20px 0 28px",
          position: "relative",
        }}
      >
        {/* Edge fades for polish */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 100,
            height: "100%",
            background: `linear-gradient(90deg, ${C.surface} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 100,
            height: "100%",
            background: `linear-gradient(270deg, ${C.surface} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />

        {/* Scrolling track — never pauses */}
        <div
          className="trust-marquee-track"
          style={{
            display: "flex",
            alignItems: "center",
            width: "max-content",
          }}
        >
          {items.map((partner, i) => (
            <PartnerItem key={`${partner.alt}-${i}`} partner={partner} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes trust-marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-25%);
          }
        }

        .trust-marquee-track {
          animation: trust-marquee 28s linear infinite;
          will-change: transform;
        }

        @media (prefers-reduced-motion: reduce) {
          .trust-marquee-track {
            animation: none;
            justify-content: center;
            flex-wrap: wrap;
            gap: 12px;
          }
        }
      `}</style>
    </section>
  );
}
