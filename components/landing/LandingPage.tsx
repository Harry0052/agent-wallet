"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { calicoTheme } from "@/styles/theme";
import { C } from "./landingConstants";
import { LandingNav } from "./LandingNav";
import { LandingHero } from "./LandingHero";
import { TrustCarousel } from "./TrustCarousel";
import { LandingHowItWorks } from "./LandingHowItWorks";
import { LandingFeatures } from "./LandingFeatures";
import { LandingTrust } from "./LandingTrust";
import { LandingTestimonials } from "./LandingTestimonials";
import { LandingPricing } from "./LandingPricing";
import { LandingCta } from "./LandingCta";
import { LandingFooter } from "./LandingFooter";

/* ── Shared section sequence ──────────────────────────────────── */

function LandingSectionsContent() {
  return (
    <>
      <LandingHero />
      <TrustCarousel />
      <LandingHowItWorks />
      <LandingFeatures />
      <LandingTrust />
      <LandingTestimonials />
      <LandingPricing />
      <LandingCta />
      <LandingFooter />
      {/* Seam bridge — visually blends footer→hero backgrounds */}
      <div
        aria-hidden="true"
        style={{
          height: 160,
          background: `linear-gradient(180deg, ${C.warmWhite} 0%, ${C.cream} 50%, ${C.warmWhite} 100%)`,
        }}
      />
    </>
  );
}

/**
 * Clone wrapper that properly sets `inert` via a ref (avoiding React's boolean attribute warning)
 * and strips duplicate IDs from the cloned DOM to prevent accessibility/anchor conflicts.
 */
function CloneWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Set inert imperatively — React doesn't natively support the `inert` boolean attribute
    el.setAttribute("inert", "");

    // Remove duplicate IDs from the clone so anchors (#features, etc.) target the original
    const idsInClone = el.querySelectorAll("[id]");
    idsInClone.forEach((node) => node.removeAttribute("id"));
  }, []);

  return (
    <div ref={ref} aria-hidden="true">
      {children}
    </div>
  );
}

/* ── Dimensional seam constants ───────────────────────────────── */

// The transition zone where 3D effects apply, measured in pixels from the seam boundary.
const SEAM_ZONE_PX = 600;

// Maximum transform values at the peak of the seam (all very subtle).
const MAX_ROTATE_X = 1.2; // degrees
const MAX_TRANSLATE_Z = -20; // px (pushes content slightly "into" screen)
const MAX_SCALE = 0.992;
const MAX_BLUR = 1.5; // px
const PERSPECTIVE = 1200; // px

/* ── Main component ───────────────────────────────────────────── */

export function LandingPage() {
  const copy1Ref = useRef<HTMLDivElement>(null);
  const seamRef = useRef<HTMLDivElement>(null);
  const isAdjusting = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect reduced motion preference on mount
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const handleScroll = useCallback(() => {
    if (isAdjusting.current) return;

    const copy1 = copy1Ref.current;
    const seamEl = seamRef.current;
    if (!copy1) return;

    const singleHeight = copy1.offsetHeight;
    if (singleHeight === 0) return;

    const scrollY = window.scrollY;

    /* ── Dimensional seam effect ────────────────────────────── */
    if (seamEl) {
      // Distance from the bottom of copy-1 (the seam boundary)
      const distToSeam = singleHeight - scrollY;

      if (distToSeam > 0 && distToSeam < SEAM_ZONE_PX) {
        // Progress: 0 = just entered zone, 1 = at the seam
        const rawProgress = 1 - distToSeam / SEAM_ZONE_PX;
        // Smooth ease-in-out curve for organic feel
        const p = rawProgress * rawProgress * (3 - 2 * rawProgress);

        const rotateX = p * MAX_ROTATE_X;
        const translateZ = p * MAX_TRANSLATE_Z;
        const scale = 1 - p * (1 - MAX_SCALE);
        const blur = p * MAX_BLUR;

        seamEl.style.transform =
          `perspective(${PERSPECTIVE}px) rotateX(${rotateX}deg) translateZ(${translateZ}px) scale(${scale})`;
        seamEl.style.filter = blur > 0.1 ? `blur(${blur}px)` : "none";
        seamEl.style.opacity = `${1 - p * 0.08}`;
      } else {
        // Outside zone — reset to flat
        seamEl.style.transform = "none";
        seamEl.style.filter = "none";
        seamEl.style.opacity = "1";
      }
    }

    /* ── Seamless loop teleport ─────────────────────────────── */
    if (scrollY >= singleHeight) {
      isAdjusting.current = true;
      window.scrollTo({ top: scrollY - singleHeight, behavior: "instant" as ScrollBehavior });
      // Reset the seam effect immediately so the teleported position looks clean
      if (seamEl) {
        seamEl.style.transform = "none";
        seamEl.style.filter = "none";
        seamEl.style.opacity = "1";
      }
      requestAnimationFrame(() => {
        isAdjusting.current = false;
      });
      return;
    }

    if (scrollY < 0) {
      isAdjusting.current = true;
      window.scrollTo({ top: scrollY + singleHeight, behavior: "instant" as ScrollBehavior });
      requestAnimationFrame(() => {
        isAdjusting.current = false;
      });
    }
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll, reducedMotion]);

  return (
    <div
      className="min-h-screen"
      style={{ fontFamily: calicoTheme.fontFamily, background: calicoTheme.card }}
    >
      {/* Fixed nav — always visible, outside the looping content */}
      <LandingNav />

      {/* Copy 1 — primary content. The seamRef wraps it for 3D transforms near the seam. */}
      <div ref={copy1Ref}>
        <div
          ref={seamRef}
          style={{
            transformOrigin: "center bottom",
            willChange: "transform, filter, opacity",
            transition: "filter 0.15s ease-out",
          }}
        >
          <LandingSectionsContent />
        </div>
      </div>

      {/* Copy 2 — clone for seamless loop continuity */}
      <CloneWrapper>
        <LandingSectionsContent />
      </CloneWrapper>
    </div>
  );
}
