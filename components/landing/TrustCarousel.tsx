"use client";

import { motion } from "framer-motion";
import { C } from "./landingConstants";
import { fadeUp, viewportOnce } from "./landingMotion";

/* ── Partner logos as inline SVGs (grayscale, lightweight) ──── */

function PlaidLogo() {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.5 3L14 6.5L17.5 10L21 6.5L17.5 3Z" fill="#6B5B4B" opacity="0.7" />
      <path d="M10.5 3L7 6.5L10.5 10L14 6.5L10.5 3Z" fill="#6B5B4B" opacity="0.5" />
      <path d="M17.5 10L14 13.5L17.5 17L21 13.5L17.5 10Z" fill="#6B5B4B" opacity="0.5" />
      <path d="M10.5 10L7 13.5L10.5 17L14 13.5L10.5 10Z" fill="#6B5B4B" opacity="0.7" />
      <path d="M24.5 10L21 13.5L24.5 17L28 13.5L24.5 10Z" fill="#6B5B4B" opacity="0.35" />
      <path d="M10.5 17L7 20.5L10.5 24L14 20.5L10.5 17Z" fill="#6B5B4B" opacity="0.35" />
      <text x="32" y="18" fontFamily="'DM Sans', system-ui, sans-serif" fontSize="14" fontWeight="700" fill="#3A332E" letterSpacing="-0.02em">plaid</text>
    </svg>
  );
}

function StripeLogo() {
  return (
    <svg width="68" height="28" viewBox="0 0 68 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="19" fontFamily="'DM Sans', system-ui, sans-serif" fontSize="16" fontWeight="700" fill="#3A332E" letterSpacing="-0.03em">stripe</text>
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="76" height="28" viewBox="0 0 76 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="19" fontFamily="'DM Sans', system-ui, sans-serif" fontSize="16" fontWeight="600" fill="#3A332E" letterSpacing="-0.02em">Google</text>
    </svg>
  );
}

function ClaudeLogo() {
  return (
    <svg width="90" height="28" viewBox="0 0 90 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 8C10 8 6 10 6 14C6 18 10 20 10 20" stroke="#6B5B4B" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path d="M14 6L10 14L14 22" stroke="#6B5B4B" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M18 8L14 14L18 20" stroke="#6B5B4B" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <text x="24" y="18" fontFamily="'DM Sans', system-ui, sans-serif" fontSize="13" fontWeight="700" fill="#3A332E" letterSpacing="-0.02em">Claude AI</text>
    </svg>
  );
}

/* ── Partner data ──────────────────────────────────────────── */

const partners = [
  { logo: PlaidLogo, label: "Partnered with Plaid" },
  { logo: StripeLogo, label: "Powered by Stripe" },
  { logo: GoogleLogo, label: "Partnered by Google" },
  { logo: ClaudeLogo, label: "Partnered by Claude AI" },
];

/* ── Single partner item ──────────────────────────────────── */

function PartnerItem({ logo: Logo, label }: { logo: () => JSX.Element; label: string }) {
  return (
    <div
      className="trust-carousel-item"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "0 40px",
        flexShrink: 0,
        cursor: "default",
      }}
    >
      <div
        style={{
          opacity: 0.55,
          transition: "opacity 0.3s ease, transform 0.3s ease",
          filter: "grayscale(100%)",
        }}
        className="trust-carousel-logo"
      >
        <Logo />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: C.textMuted,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
          fontFamily: C.fontFamily,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */

export function TrustCarousel() {
  // Duplicate items for seamless infinite scroll
  const items = [...partners, ...partners, ...partners];

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
      {/* Subtle trust statement */}
      <motion.p
        variants={fadeUp}
        initial="initial"
        whileInView="animate"
        viewport={viewportOnce}
        style={{
          textAlign: "center",
          fontSize: 12,
          fontWeight: 500,
          color: C.textMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          margin: 0,
          paddingTop: 24,
          fontFamily: C.fontFamily,
        }}
      >
        Trusted infrastructure used by millions
      </motion.p>

      {/* Carousel track */}
      <div
        style={{
          padding: "20px 0 28px",
          position: "relative",
        }}
      >
        {/* Edge fades */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 80,
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
            width: 80,
            height: "100%",
            background: `linear-gradient(270deg, ${C.surface} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />

        {/* Scrolling track */}
        <div
          className="trust-carousel-track"
          style={{
            display: "flex",
            alignItems: "center",
            width: "max-content",
          }}
        >
          {items.map((partner, i) => (
            <PartnerItem key={`${partner.label}-${i}`} {...partner} />
          ))}
        </div>
      </div>

      {/* Inline styles for animation + hover */}
      <style jsx global>{`
        @keyframes trust-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(calc(-100% / 3));
          }
        }

        .trust-carousel-track {
          animation: trust-scroll 30s linear infinite;
        }

        .trust-carousel-track:hover {
          animation-play-state: paused;
        }

        .trust-carousel-item:hover .trust-carousel-logo {
          opacity: 0.85 !important;
          transform: scale(1.05);
        }

        @media (prefers-reduced-motion: reduce) {
          .trust-carousel-track {
            animation: none;
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
          }
        }
      `}</style>
    </section>
  );
}
