"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface WelcomeModalProps {
  open: boolean;
  onStart: () => void;
}

export function WelcomeModal({ open, onStart }: WelcomeModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: "rgba(17, 17, 17, 0.15)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 0.7, 0.2, 1] }}
        className="w-full max-w-md"
        style={{
          borderRadius: 28,
          background: "rgba(255, 252, 248, 0.88)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          border: "1px solid rgba(242, 222, 204, 0.6)",
          boxShadow: "0 24px 80px rgba(17, 17, 17, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
          padding: "40px 36px",
          textAlign: "center",
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.4, ease: [0.16, 0.7, 0.2, 1] }}
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center"
          style={{ borderRadius: 16, background: "rgba(253, 186, 116, 0.22)" }}
        >
          <img
            src="/agent-wallet-icon.png"
            alt="Agent Wallet"
            style={{ width: 32, height: 32, borderRadius: 8 }}
          />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.35 }}
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 700,
            color: "#111",
            fontFamily: "'DM Sans', sans-serif",
            lineHeight: 1.2,
          }}
        >
          Welcome to Agent Wallet
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.32, duration: 0.35 }}
          style={{
            margin: "14px 0 0",
            fontSize: 15,
            lineHeight: 1.7,
            color: "#3A332E",
          }}
        >
          I'm your all-in-one financial system. I help you understand your money,
          automate tasks, and make smarter financial decisions.
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.35 }}
          style={{
            margin: "12px 0 0",
            fontSize: 14,
            lineHeight: 1.65,
            color: "#6B5B4B",
          }}
        >
          Let's take a minute to set up your profile so I can personalize everything for you.
        </motion.p>

        <motion.button
          type="button"
          onClick={onStart}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.35, ease: [0.16, 0.7, 0.2, 1] }}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold"
          style={{
            background: "#FDBA74",
            color: "#111",
            boxShadow: "0 4px 20px rgba(253, 186, 116, 0.42)",
          }}
        >
          <Sparkles size={16} />
          Start setup
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.3 }}
          className="mt-4"
          style={{ fontSize: 12, color: "#6B5B4B" }}
        >
          Takes about 2 minutes
        </motion.p>
      </motion.div>
    </div>
  );
}
