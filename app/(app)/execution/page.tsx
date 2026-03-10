"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TinyFishLiveAccessCard } from "@/components/TinyFishLiveAccessCard";
import { AgentRail } from "@/components/AgentRail";

function ExecutionContent() {
  const searchParams = useSearchParams();
  const isDemoMode = searchParams.get("demo") === "1";

  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Tasks</p>
        <h1 className="aw-page-title">Execution</h1>
        <p className="aw-page-subtitle">
          Watch live browser activity and task progress.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <TinyFishLiveAccessCard />
        <AgentRail demoMode={isDemoMode} />
      </div>
    </div>
  );
}

export default function ExecutionPage() {
  return (
    <Suspense>
      <ExecutionContent />
    </Suspense>
  );
}
