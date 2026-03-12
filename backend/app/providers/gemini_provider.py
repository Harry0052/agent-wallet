from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GeminiResearchResult:
    answer: str
    confidence: float
    evidence: list[str]
    missing_info: list[str]
    too_complex: bool
    reason: str


@dataclass
class GeminiTaskAssessment:
    needs_browser: bool
    confidence: float
    reason: str
    answer: str


class GeminiProvider:
    """Stub integration for Gemini router and grounded research.

    TODO: Replace heuristic logic with real Gemini API calls that enforce JSON output.
    """

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def route_general(self, prompt: str) -> tuple[str, float, str]:
        """Route simple/general prompts with a confidence score."""
        normalized = prompt.strip().lower()

        if not normalized:
            return "", 0.0, "Prompt is empty."

        low_confidence_terms = {
            "legal",
            "tax",
            "medical",
            "contract",
            "regulation",
            "compliance",
            "architecture",
        }
        low_confidence = any(term in normalized for term in low_confidence_terms)

        confidence = 0.58 if low_confidence else 0.89
        answer = (
            "Direct response drafted by Gemini router stub. "
            "TODO: replace with real model output."
        )
        reason = (
            "General question appears high confidence for fast router."
            if not low_confidence
            else "General question includes high-risk or nuanced terms."
        )
        return answer, confidence, reason

    def grounded_research(self, prompt: str) -> GeminiResearchResult:
        """Perform grounded web research in the fast layer.

        TODO: Use Gemini grounded search/retrieval API and attach real sources.
        """
        normalized = prompt.lower()

        complexity_terms = {
            "compare",
            "tradeoff",
            "multi-step",
            "long-term",
            "regulatory",
            "framework",
            "synthesis",
            "nuanced",
            "deep dive",
            "comprehensive",
        }
        too_complex = len(prompt) > 350 or any(term in normalized for term in complexity_terms)

        if too_complex:
            return GeminiResearchResult(
                answer="",
                confidence=0.52,
                evidence=[
                    "Preliminary grounded snippets collected by Gemini stub.",
                    "TODO: attach source URLs and citations from real search grounding.",
                ],
                missing_info=[
                    "Authoritative source ranking",
                    "Cross-source synthesis",
                ],
                too_complex=True,
                reason="Topic appears too complex for fast-layer-only synthesis.",
            )

        return GeminiResearchResult(
            answer=(
                "Grounded research summary drafted by Gemini stub. "
                "TODO: replace with grounded answer and citations."
            ),
            confidence=0.84,
            evidence=[
                "Grounded result 1 (stub evidence)",
                "Grounded result 2 (stub evidence)",
            ],
            missing_info=[],
            too_complex=False,
            reason="Grounded research appears sufficient in fast layer.",
        )

    def assess_task(self, prompt: str) -> GeminiTaskAssessment:
        """Classify whether a task needs browser automation or a plan-only answer."""
        normalized = prompt.lower()

        browser_action_terms = {
            "click",
            "type",
            "fill",
            "submit",
            "checkout",
            "log in",
            "login",
            "navigate",
            "scrape",
            "download statement",
            "open account",
            "change password",
        }
        information_only_terms = {
            "what",
            "when",
            "where",
            "why",
            "explain",
            "summarize",
            "research",
            "find information",
            "latest",
        }

        info_only = any(term in normalized for term in information_only_terms)
        needs_browser = any(term in normalized for term in browser_action_terms) and not info_only

        if needs_browser:
            return GeminiTaskAssessment(
                needs_browser=True,
                confidence=0.83,
                reason="Task includes direct DOM actions that require browser automation.",
                answer="Task classified for AgentQL browser execution.",
            )

        return GeminiTaskAssessment(
            needs_browser=False,
            confidence=0.87,
            reason="Task can be handled as planning or direct answer without browser actions.",
            answer=(
                "Planning response drafted by Gemini router stub. "
                "TODO: replace with real model output."
            ),
        )
