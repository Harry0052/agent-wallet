from __future__ import annotations

from typing import Any, Optional

from app.schemas.orchestrator import OrchestratorRequest, OrchestratorResponse
from app.services.agentql_execution_service import AgentQLExecutionService
from app.services.approval_gate_service import ApprovalGateEngine
from app.services.claude_reasoning_service import ClaudeReasoningService
from app.services.gemini_routing_service import GeminiRoutingService
from app.services.orchestrator_utils import (
    ConfidenceThresholds,
    build_execution_request,
    build_user_message,
    is_low_confidence,
    normalize_router_output,
)


class AgentWalletOrchestrator:
    """Unified orchestrator for Gemini routing, Claude fallback, and AgentQL execution."""

    def __init__(
        self,
        *,
        gemini_router: GeminiRoutingService,
        claude_reasoner: ClaudeReasoningService,
        browser_executor: AgentQLExecutionService,
        approval_gate: ApprovalGateEngine,
        thresholds: Optional[ConfidenceThresholds] = None,
    ) -> None:
        self.gemini_router = gemini_router
        self.claude_reasoner = claude_reasoner
        self.browser_executor = browser_executor
        self.approval_gate = approval_gate
        self.thresholds = thresholds or ConfidenceThresholds()

    def execute(
        self,
        *,
        prompt: str,
        category: str,
        approval_granted: bool = False,
        browser_execution_request: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Main orchestration entrypoint.

        Stages:
        1) Route with Gemini
        2) Decide direct/research/reasoning/browser path
        3) Gate browser actions with approval
        4) Return a unified response envelope
        """
        request = OrchestratorRequest(
            prompt=prompt,
            category=category,
            approval_granted=approval_granted,
            browser_execution_request=browser_execution_request or {},
        )

        envelope = OrchestratorResponse(
            route_taken="gemini_direct",
            router_output={},
            reasoning_output={},
            execution_output={},
            user_facing_message="",
            success=True,
            error="",
        )

        try:
            router_raw = self.gemini_router.route(prompt=request.prompt, category=request.category)
            router_output = normalize_router_output(router_raw)
            envelope.router_output = router_output.model_dump()
        except Exception as exc:  # noqa: BLE001
            envelope.success = False
            envelope.error = f"Gemini routing failed: {exc}"
            envelope.user_facing_message = build_user_message(
                "gemini_direct",
                success=False,
                error=envelope.error,
            )
            return envelope.model_dump()

        try:
            # Stage A: browser-required workflows
            if router_output.needs_browser:
                return self._handle_browser_path(request=request, router_output=router_output).model_dump()

            # Stage B: direct answers
            if (
                router_output.intent == "answer_direct"
                and not router_output.needs_reasoning
                and not is_low_confidence(request.category, router_output.confidence or 0.0, self.thresholds)
            ):
                envelope.route_taken = "gemini_direct"
                envelope.user_facing_message = build_user_message(
                    envelope.route_taken,
                    success=True,
                    error="",
                    router_answer=router_output.answer,
                )
                return envelope.model_dump()

            # Stage C: grounded Gemini research path
            if (
                router_output.intent == "grounded_research"
                and not router_output.needs_reasoning
                and not is_low_confidence(request.category, router_output.confidence or 0.0, self.thresholds)
            ):
                envelope.route_taken = "gemini_research"
                envelope.user_facing_message = build_user_message(
                    envelope.route_taken,
                    success=True,
                    error="",
                    router_answer=router_output.answer,
                )
                return envelope.model_dump()

            # Stage D: reasoning escalation path
            reasoning_output = self.claude_reasoner.synthesize(
                user_prompt=request.prompt,
                category=request.category,
                router_output=router_output.model_dump(),
                evidence=router_output.evidence,
            )
            envelope.route_taken = "claude_reasoning"
            envelope.reasoning_output = reasoning_output
            envelope.user_facing_message = build_user_message(
                envelope.route_taken,
                success=True,
                error="",
            )
            return envelope.model_dump()
        except Exception as exc:  # noqa: BLE001
            envelope.success = False
            envelope.error = f"Orchestration stage failed: {exc}"
            envelope.user_facing_message = build_user_message(
                envelope.route_taken,
                success=False,
                error=envelope.error,
            )
            return envelope.model_dump()

    def _handle_browser_path(self, *, request: OrchestratorRequest, router_output: Any) -> OrchestratorResponse:
        envelope = OrchestratorResponse(
            route_taken="approval_required",
            router_output=router_output.model_dump(),
            reasoning_output={},
            execution_output={},
            user_facing_message="",
            success=True,
            error="",
        )

        execution_request = build_execution_request(
            prompt=request.prompt,
            category=request.category,
            router_output=router_output,
            browser_execution_request=request.browser_execution_request,
        )

        approval_decision = self.approval_gate.evaluate(
            original_user_prompt=request.prompt,
            router_intent=router_output.intent,
            execution_plan=execution_request.model_dump(),
            category=request.category,
        )

        if approval_decision.get("needs_approval", False) and not request.approval_granted:
            # Dry-run planner output is returned so UI can render exactly what would happen.
            plan = self.browser_executor.planner(request=execution_request).model_dump()
            envelope.route_taken = "approval_required"
            envelope.execution_output = {
                "approval_decision": approval_decision,
                "execution_plan": plan,
            }
            envelope.user_facing_message = (
                "Approval required before continuing: " + approval_decision.get("approval_reason", "")
            )
            return envelope

        execution_result = self.browser_executor.executor(
            request=execution_request,
            dry_run=False,
            approval_granted=request.approval_granted,
        ).model_dump()
        envelope.route_taken = "agentql_execution"
        envelope.execution_output = {
            "approval_decision": approval_decision,
            "execution_result": execution_result,
        }
        envelope.success = execution_result.get("status") in {"completed", "paused_for_approval"}
        envelope.error = execution_result.get("error", "") if not envelope.success else ""
        envelope.user_facing_message = build_user_message(
            envelope.route_taken,
            success=envelope.success,
            error=envelope.error,
        )
        return envelope

