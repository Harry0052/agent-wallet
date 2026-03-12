from __future__ import annotations

import re

from app.providers.agentql_provider import AgentQLProvider
from app.providers.claude_provider import ClaudeProvider
from app.providers.gemini_provider import GeminiProvider
from app.schemas.workflow import Category, RouterResponse


class AgentWalletRouter:
    """Cost-optimized orchestration router for Agent Wallet."""

    GENERAL_CONFIDENCE_THRESHOLD = 0.65
    RESEARCH_CONFIDENCE_THRESHOLD = 0.70

    def __init__(
        self,
        gemini_provider: GeminiProvider,
        claude_provider: ClaudeProvider,
        agentql_provider: AgentQLProvider,
    ) -> None:
        self.gemini = gemini_provider
        self.claude = claude_provider
        self.agentql = agentql_provider

    def execute_workflow(self, prompt: str, category: str) -> dict:
        """Primary workflow entrypoint.

        Always returns the strict RouterResponse JSON contract.
        """
        normalized_prompt = prompt.strip()
        if not normalized_prompt:
            return RouterResponse(
                intent="answer_direct",
                confidence=0.0,
                reason="Prompt is empty.",
                missing_info=["prompt"],
            ).model_dump()

        requires_approval = self._requires_approval(normalized_prompt)

        try:
            category_enum = Category(category)
        except ValueError:
            return RouterResponse(
                intent="answer_direct",
                confidence=0.0,
                needs_approval=requires_approval,
                reason=f"Unsupported category '{category}'. Use general, research, or task.",
                missing_info=["category"],
            ).model_dump()

        if category_enum == Category.GENERAL:
            response = self._handle_general(normalized_prompt, requires_approval)
        elif category_enum == Category.RESEARCH:
            response = self._handle_research(normalized_prompt, requires_approval)
        else:
            response = self._handle_task(normalized_prompt, requires_approval)

        return response.model_dump()

    def execute_browser_action(self, prompt: str, approved: bool = False) -> dict:
        """Execute browser automation only when eligible and approved if needed."""
        requires_approval = self._requires_approval(prompt)

        if self._can_be_satisfied_by_grounded_retrieval(prompt):
            grounded = self.gemini.grounded_research(prompt)
            return RouterResponse(
                intent="grounded_research",
                confidence=grounded.confidence,
                needs_browser=False,
                needs_approval=requires_approval,
                answer=grounded.answer,
                evidence=grounded.evidence,
                missing_info=grounded.missing_info,
                reason="Browser bypassed because grounded retrieval is sufficient.",
            ).model_dump()

        if requires_approval and not approved:
            return RouterResponse(
                intent="browser_action",
                confidence=0.91,
                needs_browser=True,
                needs_approval=True,
                answer="",
                reason=(
                    "Approval required before browser execution for financial or "
                    "account-changing actions."
                ),
            ).model_dump()

        answer, evidence, reason = self.agentql.execute(prompt)
        return RouterResponse(
            intent="browser_action",
            confidence=0.86,
            needs_browser=True,
            needs_approval=requires_approval,
            answer=answer,
            evidence=evidence,
            reason=reason,
        ).model_dump()

    def _handle_general(self, prompt: str, requires_approval: bool) -> RouterResponse:
        answer, confidence, reason = self.gemini.route_general(prompt)

        if confidence >= self.GENERAL_CONFIDENCE_THRESHOLD:
            return RouterResponse(
                intent="answer_direct",
                confidence=confidence,
                needs_reasoning=False,
                needs_browser=False,
                needs_approval=requires_approval,
                answer=answer,
                reason=reason,
            )

        claude_answer, claude_confidence, claude_reason = self.claude.synthesize_research(
            prompt=prompt,
            evidence=["Low-confidence fast-layer route"],
            missing_info=[],
        )
        return RouterResponse(
            intent="multi_step_reasoning",
            confidence=claude_confidence,
            needs_reasoning=True,
            needs_browser=False,
            needs_approval=requires_approval,
            answer=claude_answer,
            evidence=["Escalated from Gemini general router due to low confidence."],
            reason=claude_reason,
        )

    def _handle_research(self, prompt: str, requires_approval: bool) -> RouterResponse:
        fast_research = self.gemini.grounded_research(prompt)

        if (
            not fast_research.too_complex
            and fast_research.confidence >= self.RESEARCH_CONFIDENCE_THRESHOLD
            and not fast_research.missing_info
        ):
            return RouterResponse(
                intent="grounded_research",
                confidence=fast_research.confidence,
                needs_reasoning=False,
                needs_browser=False,
                needs_approval=requires_approval,
                answer=fast_research.answer,
                evidence=fast_research.evidence,
                missing_info=fast_research.missing_info,
                reason=fast_research.reason,
            )

        claude_answer, claude_confidence, claude_reason = self.claude.synthesize_research(
            prompt=prompt,
            evidence=fast_research.evidence,
            missing_info=fast_research.missing_info,
        )
        return RouterResponse(
            intent="multi_step_reasoning",
            confidence=claude_confidence,
            needs_reasoning=True,
            needs_browser=False,
            needs_approval=requires_approval,
            answer=claude_answer,
            evidence=fast_research.evidence,
            missing_info=fast_research.missing_info,
            reason=claude_reason,
        )

    def _handle_task(self, prompt: str, requires_approval: bool) -> RouterResponse:
        task_assessment = self.gemini.assess_task(prompt)

        if task_assessment.needs_browser:
            # Critical rule: do not use browser if grounded retrieval can already solve it.
            if self._can_be_satisfied_by_grounded_retrieval(prompt):
                grounded = self.gemini.grounded_research(prompt)
                return RouterResponse(
                    intent="grounded_research",
                    confidence=grounded.confidence,
                    needs_reasoning=False,
                    needs_browser=False,
                    needs_approval=requires_approval,
                    answer=grounded.answer,
                    evidence=grounded.evidence,
                    missing_info=grounded.missing_info,
                    reason="Task downgraded from browser to grounded retrieval.",
                )

            return RouterResponse(
                intent="browser_action",
                confidence=task_assessment.confidence,
                needs_reasoning=False,
                needs_browser=True,
                needs_approval=requires_approval,
                answer=task_assessment.answer,
                reason=task_assessment.reason,
            )

        return RouterResponse(
            intent="answer_direct",
            confidence=task_assessment.confidence,
            needs_reasoning=False,
            needs_browser=False,
            needs_approval=requires_approval,
            answer=task_assessment.answer,
            reason=task_assessment.reason,
        )

    @staticmethod
    def _requires_approval(prompt: str) -> bool:
        normalized = prompt.lower()
        approval_patterns = [
            r"\b(buy|purchase|checkout|pay|subscribe|place order)\b",
            r"\b(transfer funds|send money|wire transfer|top up|add funds|cash out)\b",
            r"\b(modify account|change password|update email|close account|delete account)\b",
            r"\b(link bank account|unlink bank account|change billing|upgrade plan|downgrade plan)\b",
        ]
        return any(re.search(pattern, normalized) for pattern in approval_patterns)

    @staticmethod
    def _can_be_satisfied_by_grounded_retrieval(prompt: str) -> bool:
        normalized = prompt.lower()

        retrieval_signals = [
            "what",
            "when",
            "where",
            "who",
            "which",
            "why",
            "how much",
            "find",
            "research",
            "latest",
            "price of",
            "compare",
        ]
        browser_required_signals = [
            "click",
            "fill",
            "submit",
            "log in",
            "login",
            "open dashboard",
            "navigate to",
            "upload",
            "download from",
            "checkout",
        ]

        has_retrieval_signal = any(signal in normalized for signal in retrieval_signals)
        has_browser_signal = any(signal in normalized for signal in browser_required_signals)

        return has_retrieval_signal and not has_browser_signal
