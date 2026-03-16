"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WelcomeModal } from "./WelcomeModal";
import { PersonaOnboarding } from "./PersonaOnboarding";

export function OnboardingGate() {
  const [phase, setPhase] = useState<"welcome" | "chat">("welcome");

  const handleStart = () => {
    setPhase("chat");
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(160deg, #FFF7ED 0%, #FFFCF8 100%)" }}
    >
      <AnimatePresence mode="wait">
        {phase === "welcome" ? (
          <motion.div
            key="welcome"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
            transition={{ duration: 0.35, ease: [0.4, 0, 1, 1] }}
            className="min-h-screen"
          >
            <WelcomeModal open onStart={handleStart} />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.5, ease: [0.16, 0.7, 0.2, 1] }}
            className="min-h-screen"
          >
            <PersonaOnboarding />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
