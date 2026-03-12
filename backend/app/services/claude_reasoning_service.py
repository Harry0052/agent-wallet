from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from pydantic import ValidationError

from app.schemas.claude_reasoning import ClaudeReasoningRequest, ClaudeSynthesisOutput

CLAUDE_REASONING_SYSTEM_PROMPT = """
You are Claude, the premium reasoning fallback for Agent Wallet.

Mission:
- Synthesize only from the provided user prompt, router output, and evidence.
- Do not invent facts that are not supported by provided evidence.
- Clearly state uncertainty if evidence is thin, stale, incomplete, or conflicting.
- Never propose browser actions and never output browser-execution instructions.

Safety:
- If the prompt touches purchases, payments, transfers, wallets, subscriptions, checkout,
  or account actions, preserve conservative financial safety language in the answer.

Output rules:
- Return JSON only.
- Use exactly this schema:
{
  "final_answer": "",
  "summary": "",
  "key_points": [],
  "risks_or_uncertainties": [],
  "citations_or_evidence_used": [],
  "requires_user_followup": false
}
""".strip()


class ClaudeTransport(Protocol):
    def generate_json(
        self,
        *,
        api_key: str,
        model: str,
        system_prompt: str,
        context_payload: dict[str, Any],
        timeout_s: int,
    ) -> str:
        """Return Claude output as a JSON string."""


@dataclass
class AnthropicSDKTransport:
    """Anthropic SDK integration stub.

    TODO:
    - Install anthropic SDK: `pip install anthropic`
    - Validate model identifier used in your account/region.
    - Add retries/backoff and request tracing in production.
    """

    max_tokens: int = 1200
    temperature: float = 0.2

    def generate_json(
        self,
        *,
        api_key: str,
        model: str,
        system_prompt: str,
        context_payload: dict[str, Any],
        timeout_s: int,
    ) -> str:
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise RuntimeError(
                "Anthropic SDK is not installed. Install `anthropic` and configure API key."
            ) from exc

        client = Anthropic(api_key=api_key, timeout=timeout_s)
        message = client.messages.create(
            model=model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(context_payload, ensure_ascii=True),
                        }
                    ],
                }
            ],
        )

        text_blocks = []
        for block in getattr(message, "content", []):
            if getattr(block, "type", None) == "text":
                text_blocks.append(getattr(block, "text", ""))
        raw_text = "\n".join(part for part in text_blocks if part)
        if not raw_text.strip():
            raise RuntimeError("Claude returned empty content.")
        return raw_text


class ClaudeReasoningService:
    """Premium reasoning synthesizer for router escalations."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "claude-sonnet-4-6",
        confidence_threshold: float = 0.70,
        timeout_s: int = 30,
        transport: Optional[ClaudeTransport] = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.confidence_threshold = confidence_threshold
        self.timeout_s = timeout_s
        self.transport = transport or AnthropicSDKTransport()

    def synthesize(
        self,
        *,
        user_prompt: str,
        category: str,
        router_output: dict[str, Any],
        evidence: list[str],
    ) -> dict[str, Any]:
        request = ClaudeReasoningRequest(
            user_prompt=user_prompt,
            category=category,
            router_output=router_output or {},
            evidence=evidence or [],
        )
        context = transform_gemini_evidence_to_claude_context(
            user_prompt=request.user_prompt,
            category=request.category,
            router_output=request.router_output,
            evidence=request.evidence,
        )

        if not self._should_invoke_claude(request=request):
            response = self._fallback_without_claude(
                context=context,
                reason="Router did not require premium reasoning fallback.",
            )
            return response.model_dump()

        if not self.api_key:
            response = self._fallback_without_claude(
                context=context,
                reason="Claude API key missing; returned safe synthesis fallback.",
            )
            return response.model_dump()

        try:
            raw_text = self.transport.generate_json(
                api_key=self.api_key,
                model=self.model,
                system_prompt=CLAUDE_REASONING_SYSTEM_PROMPT,
                context_payload=context,
                timeout_s=self.timeout_s,
            )
            parsed = self._parse_json_object(raw_text)
            validated = ClaudeSynthesisOutput.model_validate(parsed)
        except (RuntimeError, ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            response = self._fallback_without_claude(
                context=context,
                reason=f"Claude synthesis failed validation: {exc}",
            )
            return response.model_dump()

        normalized = self._normalize_output(
            output=validated,
            context=context,
        )
        return normalized.model_dump()

    def _should_invoke_claude(self, *, request: ClaudeReasoningRequest) -> bool:
        router = request.router_output
        needs_reasoning = bool(router.get("needs_reasoning", False))
        confidence = _safe_float(router.get("confidence"), default=0.0)
        low_confidence = confidence < self.confidence_threshold
        intent = str(router.get("intent", "")).strip().lower()

        high_quality_keywords = [
            "synthesize",
            "comparison",
            "compare",
            "summarize",
            "high-quality writing",
            "polish",
            "executive brief",
            "nuanced",
        ]
        prompt_lower = request.user_prompt.lower()
        needs_high_quality = any(token in prompt_lower for token in high_quality_keywords)

        # Claude service does not execute browser decisions; block those intents.
        if intent == "browser_action":
            return False

        return needs_reasoning or low_confidence or needs_high_quality

    def _parse_json_object(self, text: str) -> dict[str, Any]:
        stripped = text.strip()
        try:
            parsed = json.loads(stripped)
            if not isinstance(parsed, dict):
                raise ValueError("Claude JSON root must be an object.")
            return parsed
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise
            parsed = json.loads(stripped[start : end + 1])
            if not isinstance(parsed, dict):
                raise ValueError("Extracted Claude JSON root must be an object.")
            return parsed

    def _normalize_output(
        self,
        *,
        output: ClaudeSynthesisOutput,
        context: dict[str, Any],
    ) -> ClaudeSynthesisOutput:
        evidence_items = context.get("evidence_items", [])
        evidence_refs = [item.get("id") for item in evidence_items if item.get("id")]
        thin = bool(context.get("evidence_quality", {}).get("is_thin"))
        conflicting = bool(context.get("evidence_quality", {}).get("has_conflict_signals"))
        financial = bool(context.get("safety", {}).get("financial_sensitive"))

        if not output.citations_or_evidence_used:
            output.citations_or_evidence_used = evidence_refs

        if thin and "Evidence is limited; conclusions may be incomplete." not in output.risks_or_uncertainties:
            output.risks_or_uncertainties.append("Evidence is limited; conclusions may be incomplete.")
            output.requires_user_followup = True

        if conflicting and "Evidence appears conflicting across provided snippets." not in output.risks_or_uncertainties:
            output.risks_or_uncertainties.append("Evidence appears conflicting across provided snippets.")
            output.requires_user_followup = True

        if financial:
            safety_line = (
                "For financial/account actions, verify details and require explicit user approval before execution."
            )
            if safety_line.lower() not in output.final_answer.lower():
                if output.final_answer.strip():
                    output.final_answer = f"{output.final_answer.strip()} {safety_line}"
                else:
                    output.final_answer = safety_line

        if not output.summary.strip():
            output.summary = "Synthesis generated from provided router context and evidence."

        if not output.final_answer.strip():
            output.final_answer = "Insufficient validated evidence for a confident final answer."
            output.requires_user_followup = True

        return output

    def _fallback_without_claude(
        self,
        *,
        context: dict[str, Any],
        reason: str,
    ) -> ClaudeSynthesisOutput:
        evidence_items = context.get("evidence_items", [])
        evidence_refs = [item.get("id") for item in evidence_items if item.get("id")]
        thin = bool(context.get("evidence_quality", {}).get("is_thin"))
        conflicting = bool(context.get("evidence_quality", {}).get("has_conflict_signals"))
        financial = bool(context.get("safety", {}).get("financial_sensitive"))

        risks = [reason]
        if thin:
            risks.append("Evidence is limited; more sources are needed for confident synthesis.")
        if conflicting:
            risks.append("Evidence appears conflicting; reconcile sources before acting.")

        final_answer = "Synthesis unavailable; using safe fallback summary from provided evidence."
        if financial:
            final_answer += " For financial/account actions, require explicit user approval before execution."

        summary = "Fallback summary generated without Claude API call."
        key_points = [item.get("text", "") for item in evidence_items[:5] if item.get("text", "")]

        return ClaudeSynthesisOutput(
            final_answer=final_answer,
            summary=summary,
            key_points=key_points,
            risks_or_uncertainties=risks,
            citations_or_evidence_used=evidence_refs,
            requires_user_followup=thin or conflicting,
        )


def transform_gemini_evidence_to_claude_context(
    *,
    user_prompt: str,
    category: str,
    router_output: dict[str, Any],
    evidence: list[str],
) -> dict[str, Any]:
    """Prepare normalized context for Claude from Gemini router output/evidence."""
    normalized_evidence = []
    seen = set()
    for item in evidence:
        text = str(item).strip()
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        normalized_evidence.append(text)

    thin = len(normalized_evidence) < 2
    conflicting = _has_conflict_signals(normalized_evidence)

    evidence_items = []
    for idx, text in enumerate(normalized_evidence, start=1):
        evidence_items.append({"id": f"E{idx}", "text": text})

    router_context = {
        "intent": str(router_output.get("intent", "")).strip().lower(),
        "confidence": _safe_float(router_output.get("confidence"), default=0.0),
        "needs_reasoning": bool(router_output.get("needs_reasoning", False)),
        "reason": str(router_output.get("reason", "")),
        "missing_info": _as_string_list(router_output.get("missing_info", [])),
        "answer": str(router_output.get("answer", "")),
    }

    return {
        "user_prompt": user_prompt,
        "category": str(category).strip().lower(),
        "router_context": router_context,
        "evidence_items": evidence_items,
        "evidence_quality": {
            "is_thin": thin,
            "has_conflict_signals": conflicting,
        },
        "safety": {
            "financial_sensitive": _is_financial_sensitive(user_prompt),
        },
    }


def _has_conflict_signals(evidence: list[str]) -> bool:
    conflict_tokens = ["conflict", "contradict", "disagree", "however", "on the other hand"]
    lowered = " ".join(evidence).lower()
    return any(token in lowered for token in conflict_tokens)


def _safe_float(value: Any, *, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)]


def _is_financial_sensitive(prompt: str) -> bool:
    lowered = prompt.lower()
    tokens = [
        "purchase",
        "buy",
        "payment",
        "pay",
        "transfer",
        "wallet",
        "subscription",
        "checkout",
        "account",
    ]
    return any(token in lowered for token in tokens)

