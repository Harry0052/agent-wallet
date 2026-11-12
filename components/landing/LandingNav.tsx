"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { C } from "./landingConstants";

const links = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Security", href: "#trust" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="fixed inset-x-0 top-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(255,247,237,0.92)" : "transparent",
        borderBottom: `1px solid ${scrolled ? C.border : "transparent"}`,
        backdropFilter: scrolled ? "blur(16px)" : "none",
        boxShadow: scrolled ? C.shadow : "none",
      }}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4 md:px-10">
        <div className="flex items-center gap-2">
          <img
            src="/calico-icon.png"
            alt="Agent Wallet"
            style={{ width: 28, height: 28, borderRadius: 7, objectFit: "cover" }}
          />
          <span
            className="text-base"
            style={{ color: C.charcoal, fontFamily: C.fontFamily, fontWeight: 700 }}
          >
            Agent Wallet
          </span>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-lg px-3.5 py-2 text-[0.84rem] font-medium transition-colors"
              style={{ color: C.textSecondary }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = C.textPrimary;
                e.currentTarget.style.background = C.apricotSoft;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = C.textSecondary;
                e.currentTarget.style.background = "transparent";
              }}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden rounded-lg px-4 py-2 text-[0.84rem] font-medium transition-colors sm:inline-flex"
            style={{ color: C.textSecondary }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.textPrimary)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.textSecondary)}
          >
            Sign in
          </Link>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[0.84rem] font-semibold"
              style={{
                background: C.apricot,
                color: C.charcoal,
                boxShadow: "0 2px 12px rgba(253,186,116,0.4)",
              }}
            >
              Get early access
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.nav>
  );
}
