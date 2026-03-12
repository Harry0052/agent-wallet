from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict
from urllib.parse import urlparse

from app.schemas.agentql_execution import AgentQLExecutionRequest
from app.schemas.gemini_routing import GeminiRoutingOutput


@dataclass(frozen=True)
class ConfidenceThresholds:
    general: float = 0.65
    research: float = 0.70
    task: float = 0.70


def normalize_router_output(router_output: dict[str, Any]) -> GeminiRoutingOutput:
    return GeminiRoutingOutput.model_validate(router_output or {})


def is_low_confidence(category: str, confidence: float, thresholds: ConfidenceThresholds) -> bool:
    lowered = category.lower()
    if lowered == "general":
        return confidence < thresholds.general
    if lowered == "research":
        return confidence < thresholds.research
    return confidence < thresholds.task


def build_execution_request(
    *,
    prompt: str,
    category: str,
    router_output: GeminiRoutingOutput,
    browser_execution_request: dict[str, Any],
) -> AgentQLExecutionRequest:
    merged: Dict[str, Any] = dict(browser_execution_request or {})
    merged.setdefault("goal", prompt)
    merged.setdefault("site", infer_site(prompt) or "https://example.com")
    merged.setdefault("steps", infer_steps_from_prompt(prompt=prompt, router_intent=router_output.intent))
    merged.setdefault("needs_approval", bool(router_output.needs_approval))
    merged.setdefault("data_to_extract", router_output.evidence if category == "research" else [])
    merged.setdefault("stop_before_commit", True)
    return AgentQLExecutionRequest.model_validate(merged)


def infer_site(prompt: str) -> str:
    url_match = re.search(r"https?://[^\s]+", prompt, flags=re.IGNORECASE)
    if url_match:
        return url_match.group(0).rstrip(".,)")

    domain_match = re.search(r"\b([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(/[^\s]*)?\b", prompt)
    if domain_match:
        domain = domain_match.group(1)
        path = domain_match.group(2) or ""
        parsed = urlparse(f"https://{domain}{path}")
        return parsed.geturl()
    return ""


def infer_steps_from_prompt(*, prompt: str, router_intent: str) -> list[dict[str, Any]]:
    text = prompt.lower()
    steps: list[dict[str, Any]] = [{"action": "navigate", "target": infer_site(prompt) or "https://example.com"}]

    if "log in" in text or "login" in text:
        steps.append({"action": "login", "description": "Login required by prompt."})

    if "fill" in text or "type" in text:
        steps.append(
            {
                "action": "fill",
                "target": "TODO_INPUT_SELECTOR",
                "value": "TODO_INPUT_VALUE",
                "description": "TODO: map concrete form selector/value.",
            }
        )

    if "click" in text:
        steps.append(
            {
                "action": "click",
                "target": "TODO_CLICK_SELECTOR",
                "description": "TODO: map click target selector.",
            }
        )

    if "extract" in text or "dashboard" in text:
        steps.append({"action": "extract", "target": "TODO_EXTRACT_QUERY"})

    if any(token in text for token in ["checkout", "purchase", "confirm", "submit", "transfer", "cancel"]):
        steps.append(
            {
                "action": "click",
                "target": "TODO_FINAL_CONFIRM_SELECTOR",
                "irreversible": True,
                "description": "Final commit-like action inferred from prompt.",
            }
        )

    if router_intent == "browser_action" and len(steps) == 1:
        steps.append(
            {
                "action": "click",
                "target": "TODO_ACTION_SELECTOR",
                "description": "Generic browser interaction inferred by router.",
            }
        )
    return steps


def build_user_message(route: str, *, success: bool, error: str, router_answer: str = "") -> str:
    if not success:
        return f"Workflow failed: {error}"

    messages = {
        "gemini_direct": router_answer or "Answered directly with Gemini fast router.",
        "gemini_research": router_answer or "Returned grounded research from Gemini.",
        "claude_reasoning": "Returned synthesized response from Claude reasoning fallback.",
        "approval_required": "Approval is required before executing irreversible actions.",
        "agentql_execution": "Executed browser workflow via AgentQL.",
    }
    return messages.get(route, "Workflow completed.")

