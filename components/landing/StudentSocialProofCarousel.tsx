"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { C, overlineStyle } from "./landingConstants";
import { fadeUp, viewportOnce } from "./landingMotion";

/* ── School data (easy to extend) ────────────────────────────── */

interface School {
  src: string;
  alt: string;
  shortName: string;
  height: number;
}

const schools: School[] = [
  { src: "/logos/ucla.png", alt: "UCLA logo", shortName: "UCLA", height: 42 },
  { src: "/logos/uci.png", alt: "UCI logo", shortName: "UCI", height: 42 },
  { src: "/logos/usc.png", alt: "USC logo", shortName: "USC", height: 42 },
  { src: "/logos/stanford.png", alt: "Stanford logo", shortName: "Stanford", height: 42 },
  { src: "/logos/calpoly.png", alt: "Cal Poly logo", shortName: "Cal Poly", height: 42 },
];

/* ── Single school item ──────────────────────────────────────── */

function SchoolItem({ school }: { school: School }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: "0 48px",
        flexShrink: 0,
      }}
    >
      <Image
        src={school.src}
        alt={school.alt}
        width={Math.round(school.height * 3)}
        height={school.height}
        style={{
          height: school.height,
          width: "auto",
          objectFit: "contain",
          opacity: 0.85,
          userSelect: "none",
          pointerEvents: "none",
        }}
        draggable={false}
        unoptimized
      />
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export function StudentSocialProofCarousel() {
  // 4x duplication for seamless infinite scroll
  const items = [...schools, ...schools, ...schools, ...schools];

  return (
    <div
      style={{
        overflow: "hidden",
        position: "relative",
        paddingTop: 28,
      }}
    >
      {/* Eyebrow + heading */}
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={viewportOnce}
        variants={fadeUp}
        className="mb-5 text-center"
      >
        <p
          style={{
            ...overlineStyle,
            color: C.textMuted,
            letterSpacing: "0.12em",
            marginBottom: 6,
          }}
        >
          Trusted by students nationwide
        </p>
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: C.textSecondary,
            fontFamily: C.fontFamily,
            margin: 0,
          }}
        >
          Used by students at
        </p>
      </motion.div>

      {/* Carousel track */}
      <div
        style={{
          position: "relative",
          padding: "8px 0 6px",
        }}
      >
        {/* Edge fades */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 60,
            height: "100%",
            background: `linear-gradient(90deg, ${C.cream} 0%, transparent 100%)`,
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
            width: 60,
            height: "100%",
            background: `linear-gradient(270deg, ${C.cream} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />

        {/* Scrolling track — never pauses */}
        <div
          className="student-proof-track"
          style={{
            display: "flex",
            alignItems: "center",
            width: "max-content",
          }}
        >
          {items.map((school, i) => (
            <SchoolItem key={`${school.shortName}-${i}`} school={school} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes student-proof-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-25%);
          }
        }

        .student-proof-track {
          animation: student-proof-scroll 22s linear infinite;
          will-change: transform;
        }

        @media (prefers-reduced-motion: reduce) {
          .student-proof-track {
            animation: none;
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
}
