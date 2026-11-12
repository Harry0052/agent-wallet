"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Landmark, Sparkles } from "lucide-react";
import { completePersonaOnboarding, type PersonaData } from "@/services/persona";
import { connectAccountsViaSupportedFlow } from "@/services/connect";

interface Message {
  role: "assistant" | "user";
  text: string;
}

const AGENT_WALLET_QUESTIONS: { key: string; message: string }[] = [
  {
    key: "intro",
    message:
      "Hi! Welcome to Agent Wallet \ud83d\udc31\n\nI'm your money system \u2014 here to help you understand your money, build good habits, and make smarter decisions.\n\nLet me learn a little about you so I can give better guidance.\n\nWhat's your name?",
  },
  {
    key: "about",
    message:
      "Nice to meet you, {{name}}! \ud83d\udc4b\n\nTell me a bit about yourself \u2014 how old are you, and what's your situation? Student, working, freelancing? No pressure to be exact.",
  },
  {
    key: "goals",
    message:
      "Got it! That helps me tailor things for you.\n\nWhat are your main money goals right now? Things like saving for something, paying off debt, building a cushion, or learning to invest.",
  },
  {
    key: "stress",
    message:
      "Those are solid goals. \ud83d\udcaa\n\nWhat's the thing about money that feels hardest or most confusing? Be honest \u2014 I'm here to help, not judge.",
  },
  {
    key: "habits",
    message:
      "I hear you. A lot of people feel that way.\n\nHow would you describe your spending and saving habits? Do you tend to spend freely, or are you more of a planner? Do you save regularly?",
  },
  {
    key: "investing",
    message:
      "That's really helpful.\n\nLast thing \u2014 are you interested in investing? And how comfortable are you with risk? (Conservative, moderate, or okay with some risk?)",
  },
];

function parsePersonaFromConversation(
  answers: Record<string, string>,
  fullConversation: string,
): PersonaData {
  const name = answers.intro?.trim() || undefined;

  const aboutText = answers.about || "";
  let occupation: string | undefined;
  let ageRange: string | undefined;

  const ageMatch = aboutText.match(/\b(\d{2})\b/);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age < 25) ageRange = "18-24";
    else if (age < 35) ageRange = "25-34";
    else if (age < 45) ageRange = "35-44";
    else if (age < 55) ageRange = "45-54";
    else ageRange = "55+";
  }

  const jobWords = aboutText
    .replace(/\b\d+\b/g, "")
    .replace(/years?\s*old/gi, "")
    .replace(/i'm|im|i am/gi, "")
    .trim();
  if (jobWords.length > 2) occupation = jobWords.slice(0, 100);

  const goalsText = answers.goals || "";
  const financialGoals = goalsText
    .split(/[,.\n]/)
    .map((g) => g.trim())
    .filter((g) => g.length > 2)
    .slice(0, 5);

  const stressText = answers.stress || "";
  const moneyStressors = stressText
    .split(/[,.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 5);

  const habitsText = answers.habits || "";
  let spendingStyle: string | undefined;
  let savingStyle: string | undefined;
  const habitsLower = habitsText.toLowerCase();
  if (habitsLower.includes("impuls")) spendingStyle = "impulsive";
  else if (habitsLower.includes("plan")) spendingStyle = "planner";
  else if (habitsLower.includes("careful")) spendingStyle = "careful";
  else if (habitsText.length > 3) spendingStyle = habitsText.slice(0, 80);

  if (habitsLower.includes("regular") || habitsLower.includes("consistent"))
    savingStyle = "regular saver";
  else if (habitsLower.includes("sporadic") || habitsLower.includes("sometimes"))
    savingStyle = "sporadic";
  else if (habitsLower.includes("not really") || habitsLower.includes("don't save"))
    savingStyle = "minimal";

  const investText = answers.investing || "";
  let investingInterest: string | undefined;
  let riskTolerance: string | undefined;
  const investLower = investText.toLowerCase();
  if (investLower.includes("not interested") || investLower.includes("no"))
    investingInterest = "not interested";
  else if (investLower.includes("curious") || investLower.includes("learning"))
    investingInterest = "curious/learning";
  else if (investLower.includes("active") || investLower.includes("yes"))
    investingInterest = "active";
  else if (investText.length > 3)
    investingInterest = investText.slice(0, 60);

  if (investLower.includes("conservative")) riskTolerance = "conservative";
  else if (investLower.includes("moderate")) riskTolerance = "moderate";
  else if (investLower.includes("high") || investLower.includes("comfortable") || investLower.includes("aggressive"))
    riskTolerance = "high";

  const summary = [
    name ? `Name: ${name}` : null,
    ageRange ? `Age range: ${ageRange}` : null,
    occupation ? `Occupation: ${occupation}` : null,
    financialGoals.length ? `Goals: ${financialGoals.join("; ")}` : null,
    moneyStressors.length ? `Stressors: ${moneyStressors.join("; ")}` : null,
    spendingStyle ? `Spending: ${spendingStyle}` : null,
    savingStyle ? `Saving: ${savingStyle}` : null,
    investingInterest ? `Investing: ${investingInterest}` : null,
    riskTolerance ? `Risk: ${riskTolerance}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    displayName: name,
    ageRange,
    occupation,
    financialGoals: financialGoals.length ? financialGoals : undefined,
    moneyStressors: moneyStressors.length ? moneyStressors : undefined,
    spendingStyle,
    savingStyle,
    investingInterest,
    riskTolerance,
    onboardingSummary: summary || undefined,
    rawConversation: fullConversation || undefined,
  };
}

export function PersonaOnboarding() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isTyping, setIsTyping] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post-persona: connect accounts step
  // "connect" = show connect/skip options, "connected" = success, "skipped" = manual
  const [connectPhase, setConnectPhase] = useState<"connect" | "connected" | "skipped" | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userName = useRef("");

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  const addAgentWalletMessage = useCallback(
    (text: string) => {
      setIsTyping(true);
      scrollToBottom();
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: "assistant", text }]);
        setIsTyping(false);
        scrollToBottom();
        setTimeout(() => inputRef.current?.focus(), 100);
      }, 600 + Math.random() * 400);
    },
    [scrollToBottom],
  );

  useEffect(() => {
    if (messages.length === 0 && AGENT_WALLET_QUESTIONS[0]) {
      addAgentWalletMessage(AGENT_WALLET_QUESTIONS[0].message);
    }
  }, [addAgentWalletMessage, messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping || isSaving) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    scrollToBottom();

    const currentQ = AGENT_WALLET_QUESTIONS[questionIndex];
    if (currentQ) {
      const newAnswers = { ...answers, [currentQ.key]: text };
      setAnswers(newAnswers);

      if (currentQ.key === "intro") {
        userName.current = text.split(" ")[0] || text;
      }
    }

    const nextIdx = questionIndex + 1;

    if (nextIdx < AGENT_WALLET_QUESTIONS.length) {
      setQuestionIndex(nextIdx);
      const nextQ = AGENT_WALLET_QUESTIONS[nextIdx];
      const nextMsg = nextQ.message.replace("{{name}}", userName.current || "there");
      addAgentWalletMessage(nextMsg);
    } else {
      // Conversation complete — save persona
      setIsTyping(true);
      scrollToBottom();

      const finalAnswers = { ...answers, [currentQ?.key || ""]: text };
      const fullConv = messages
        .concat([{ role: "user", text }])
        .map((m) => `${m.role === "assistant" ? "Agent Wallet" : "User"}: ${m.text}`)
        .join("\n\n");

      const persona = parsePersonaFromConversation(finalAnswers, fullConv);

      setIsSaving(true);
      try {
        await completePersonaOnboarding(persona);
        setIsTyping(false);
        setIsComplete(true);
        setConnectPhase("connect");
        const completionMsg = `Awesome \u2014 I've created your Agent Wallet profile${userName.current ? `, ${userName.current}` : ""}! \ud83c\udf89\n\nOne more thing \u2014 if you connect a bank account, I can show you your real balances, transactions, and spending patterns right away.\n\nYour data stays private and read-only. Agent Wallet never moves your money.`;
        setMessages((prev) => [...prev, { role: "assistant", text: completionMsg }]);
        scrollToBottom();
      } catch (err) {
        setIsTyping(false);
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleConnectAccounts = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await connectAccountsViaSupportedFlow();
      const count = result.accounts.length;
      setConnectedCount(count);
      setConnectPhase("connected");
      const successMsg = count === 1
        ? `Connected! I can see your account. Your dashboard will be ready with real data.`
        : `Connected! I can see ${count} accounts. Your dashboard will be ready with real data.`;
      setMessages((prev) => [...prev, { role: "assistant", text: successMsg }]);
      scrollToBottom();
    } catch (err) {
      // User cancelled Plaid Link or connection failed
      const msg = err instanceof Error ? err.message : "";
      if (/cancel|exit|dismiss/i.test(msg)) {
        // User closed Plaid — stay on connect phase, don't show error
      } else {
        // Surface the real error so users (and support) can diagnose failures
        const displayMsg = msg && !/request failed/i.test(msg)
          ? msg
          : "Could not connect your account. You can try again later from Settings.";
        setError(displayMsg);
        console.error("[Onboarding] Plaid connect failed:", msg);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSkipConnect = () => {
    setConnectPhase("skipped");
    const skipMsg = `No problem! You can always connect accounts later from Settings.\n\nIn the meantime, you can add accounts and transactions manually \u2014 everything works the same way.`;
    setMessages((prev) => [...prev, { role: "assistant", text: skipMsg }]);
    scrollToBottom();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const [isExiting, setIsExiting] = useState(false);

  const goToDashboard = () => {
    setIsExiting(true);
    // Allow the exit animation to play before navigating
    setTimeout(() => {
      router.replace("/home");
      router.refresh();
    }, 600);
  };

  return (
    <motion.div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-8"
      style={{ background: "linear-gradient(160deg, #FFF7ED 0%, #FFFCF8 100%)" }}
      animate={isExiting ? { opacity: 0, scale: 0.97, filter: "blur(8px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="mb-6 flex items-center gap-2"
      >
        <img
          src="/agent-wallet-icon.png"
          alt="Agent Wallet"
          style={{ width: 32, height: 32, borderRadius: 8 }}
        />
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#111",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Agent Wallet
        </span>
      </motion.div>

      {/* Progress dots */}
      <div className="mb-6 flex items-center gap-2">
        {AGENT_WALLET_QUESTIONS.map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i <= questionIndex ? 24 : 8,
              background: i <= questionIndex ? "#FDBA74" : "#F2DECC",
            }}
          />
        ))}
      </div>

      {/* Chat container — glassmorphic */}
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          borderRadius: 28,
          background: "rgba(255, 252, 248, 0.75)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(242, 222, 204, 0.6)",
          boxShadow:
            "0 8px 40px rgba(17, 17, 17, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 420,
          maxHeight: "70vh",
        }}
      >
        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6"
          style={{ scrollBehavior: "smooth" }}
        >
          <div className="flex flex-col gap-4">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "12px 16px",
                    borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    background:
                      msg.role === "user"
                        ? "#FDBA74"
                        : "rgba(255, 255, 255, 0.8)",
                    color: msg.role === "user" ? "#111" : "#3A332E",
                    fontSize: 14,
                    lineHeight: 1.65,
                    whiteSpace: "pre-line",
                    boxShadow: msg.role === "user"
                      ? "0 2px 8px rgba(253,186,116,0.25)"
                      : "0 1px 4px rgba(17,17,17,0.04)",
                    border: msg.role === "user" ? "none" : "1px solid rgba(242,222,204,0.4)",
                  }}
                >
                  {msg.text}
                </div>
              </motion.div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div
                  style={{
                    padding: "12px 20px",
                    borderRadius: "18px 18px 18px 4px",
                    background: "rgba(255,255,255,0.8)",
                    border: "1px solid rgba(242,222,204,0.4)",
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#FDBA74",
                        animation: `pulse-glow 1.2s ${d * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "16px 16px 20px",
            borderTop: "1px solid rgba(242, 222, 204, 0.4)",
            background: "rgba(255, 247, 237, 0.5)",
          }}
        >
          {isComplete && connectPhase === "connect" ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 0.7, 0.2, 1] }}
              className="space-y-2.5"
            >
              <motion.button
                type="button"
                onClick={() => { void handleConnectAccounts(); }}
                disabled={isConnecting}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
                className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold"
                style={{
                  background: "#FDBA74",
                  color: "#111",
                  boxShadow: "0 4px 16px rgba(253,186,116,0.38)",
                }}
              >
                <Landmark size={16} />
                {isConnecting ? "Connecting..." : "Connect your accounts"}
              </motion.button>
              <button
                type="button"
                onClick={handleSkipConnect}
                disabled={isConnecting}
                className="w-full rounded-full py-3 text-sm font-medium transition-colors"
                style={{ color: "#6B5B4B", background: "transparent" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(242, 222, 204, 0.3)";
                  e.currentTarget.style.color = "#3A332E";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#6B5B4B";
                }}
              >
                I'll add accounts manually
              </button>
            </motion.div>
          ) : isComplete && (connectPhase === "connected" || connectPhase === "skipped") ? (
            <motion.button
              type="button"
              onClick={goToDashboard}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 0.7, 0.2, 1] }}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              className="flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold"
              style={{
                background: "#FDBA74",
                color: "#111",
                boxShadow: "0 4px 16px rgba(253,186,116,0.38)",
              }}
            >
              <Sparkles size={16} />
              {connectPhase === "connected"
                ? `Go to my dashboard${connectedCount > 0 ? ` (${connectedCount} account${connectedCount === 1 ? "" : "s"} ready)` : ""}`
                : "Go to my dashboard"}
            </motion.button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type your answer..."
                disabled={isTyping || isSaving}
                className="flex-1 rounded-full px-5 py-3 text-sm outline-none"
                style={{
                  background: "rgba(255, 252, 248, 0.9)",
                  border: "1px solid #F2DECC",
                  color: "#111",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim() || isTyping || isSaving}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
                style={{
                  background: "#FDBA74",
                  color: "#111",
                  boxShadow: "0 2px 8px rgba(253,186,116,0.3)",
                }}
              >
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 text-center text-xs" style={{ color: "#DC2626" }}>
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Skip option */}
      {!isComplete && (
        <button
          type="button"
          onClick={async () => {
            setIsSaving(true);
            try {
              await completePersonaOnboarding({});
              router.replace("/home");
              router.refresh();
            } catch {
              setError("Could not skip onboarding");
              setIsSaving(false);
            }
          }}
          className="mt-6 text-xs transition-colors"
          style={{ color: "#6B5B4B" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#111")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6B5B4B")}
        >
          Skip for now
        </button>
      )}
    </motion.div>
  );
}
