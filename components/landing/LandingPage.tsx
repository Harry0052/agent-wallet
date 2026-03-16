"use client";

import { calicoTheme } from "@/styles/theme";
import { LandingNav } from "./LandingNav";
import { LandingHero } from "./LandingHero";
import { LandingHowItWorks } from "./LandingHowItWorks";
import { LandingFeatures } from "./LandingFeatures";
import { LandingTrust } from "./LandingTrust";
import { LandingTestimonials } from "./LandingTestimonials";
import { LandingPricing } from "./LandingPricing";
import { LandingCta } from "./LandingCta";
import { LandingFooter } from "./LandingFooter";

export function LandingPage() {
  return (
    <div className="min-h-screen" style={{ fontFamily: calicoTheme.fontFamily, background: calicoTheme.card }}>
      <LandingNav />
      <LandingHero />
      <LandingHowItWorks />
      <LandingFeatures />
      <LandingTrust />
      <LandingTestimonials />
      <LandingPricing />
      <LandingCta />
      <LandingFooter />
    </div>
  );
}
