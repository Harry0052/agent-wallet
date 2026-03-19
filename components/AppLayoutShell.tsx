"use client";

import { Suspense, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppProvider } from '@/lib/store';
import { AppNav } from '@/components/AppNav';
import { CalicoAssistant } from '@/components/CalicoAssistant';
import { TutorialOrchestrator } from '@/components/plans/TutorialOrchestrator';

function AppEntryReveal({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "revealing" | "ready">("loading");

  useEffect(() => {
    // Brief branded loading moment, then reveal
    const t1 = setTimeout(() => setPhase("revealing"), 150);
    const t2 = setTimeout(() => setPhase("ready"), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <>
      {/* App entry overlay — brief branded moment that dissolves into the dashboard */}
      <AnimatePresence>
        {phase === "loading" && (
          <motion.div
            key="app-entry-overlay"
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{
              background: "linear-gradient(160deg, #FFF7ED 0%, #FFFCF8 100%)",
            }}
            exit={{
              opacity: 0,
              scale: 1.02,
              filter: "blur(8px)",
            }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: [0.16, 0.7, 0.2, 1] }}
              className="flex items-center gap-3"
            >
              <img
                src="/calico-icon.png"
                alt="Calico"
                style={{ width: 36, height: 36, borderRadius: 10 }}
              />
              <span style={{ fontSize: 20, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif" }}>
                Calico
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The actual app shell — fades in underneath the overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={phase !== "loading" ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="sw-shell"
      >
        {children}
      </motion.div>
    </>
  );
}

export function AppLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <TutorialOrchestrator>
        <AppEntryReveal>
          <Suspense fallback={null}>
            <AppNav />
          </Suspense>
          <motion.div
            className="sw-content"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.45, ease: [0.16, 0.7, 0.2, 1] }}
          >
            {children}
          </motion.div>
          <CalicoAssistant />
        </AppEntryReveal>
      </TutorialOrchestrator>
    </AppProvider>
  );
}
