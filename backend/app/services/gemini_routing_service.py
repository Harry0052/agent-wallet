from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import ValidationError

from app.schemas.gemini_routing import Category, GeminiRoutingInput, GeminiRoutingOutput

ROUTER_SYSTEM_PROMPT = """
You are the first-pass routing model for Agent Wallet.
Your job is to classify intent and optionally provide a low-cost answer.

You MUST return JSON only with exactly these keys:
{
  "intent": "answer_direct | grounded_research | multi_step_reasoning | browser_action",
  "confidence": 0.0,
  "needs_reasoning": false,
  "needs_browser": false,
  "needs_approval": false,
  "answer": "",
  "evidence": [],
  "missing_info": [],
  "reason": ""
}

Routing rules:
1) Category = "general":
   - Use answer_direct for simple/clear requests.
2) Category = "research":
   - Attempt grounded_research first.
   - If broad, multi-country, legal-heavy, highly analytical, or cross-source synthesis is required:
     set needs_reasoning=true and intent="multi_step_reasoning".
3) Category = "task":
   - If clicking, login, navigation, DOM interaction, form fill, checkout, or live-site extraction is needed:
     set needs_browser=true and intent="browser_action".

Approval rules:
- If task includes purchase, checkout, subscription change, money transfer/top-up, or account modification:
  set needs_approval=true.

Constraints:
- Return valid JSON only. No markdown. No prose outside JSON.
- Keep confidence in [0, 1].
- Keep evidence and missing_info arrays of strings.
""".strip()


ROUTER_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {
            "type": "string",
            "enum": [
                "answer_direct",
                "grounded_research",
                "multi_step_reasoning",
                "browser_action",
            ],
        },
        "confidence": {"type": "number"},
        "needs_reasoning": {"type": "boolean"},
        "needs_browser": {"type": "boolean"},
        "needs_approval": {"type": "boolean"},
        "answer": {"type": "string"},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "missing_info": {"type": "array", "items": {"type": "string"}},
        "reason": {"type": "string"},
    },
    "required": [
        "intent",
        "needs_reasoning",
        "needs_browser",
        "needs_approval",
        "answer",
        "evidence",
        "missing_info",
        "reason",
    ],
}


class GeminiTransport(Protocol):
    def generate_json(self, *, api_key: str, model: str, payload: dict[str, Any], timeout_s: int) -> str:
        """Return a JSON string from Gemini."""


@dataclass
class GeminiRESTTransport:
    """Minimal REST transport for Gemini API."""

    base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    def generate_json(self, *, api_key: str, model: str, payload: dict[str, Any], timeout_s: int) -> str:
        url = f"{self.base_url}/models/{model}:generateContent?key={api_key}"
        body = json.dumps(payload).encode("utf-8")
        req = Request(
            url=url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(req, timeout=timeout_s) as response:
                raw_bytes = response.read()
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Gemini HTTPError {exc.code}: {details}") from exc
        except URLError as exc:
            raise RuntimeError(f"Gemini URL error: {exc.reason}") from exc

        data = json.loads(raw_bytes.decode("utf-8"))
        candidate_text = _extract_candidate_text(data)
        if not candidate_text:
            raise RuntimeError("Gemini returned no candidate JSON text.")
        return candidate_text


class GeminiRoutingService:
    """Gemini-first routing/classification service for Agent Wallet."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gemini-2.5-flash",
        timeout_s: int = 25,
        transport: Optional[GeminiTransport] = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_s = timeout_s
        self.transport = transport or GeminiRESTTransport()

    def route(self, *, prompt: str, category: str) -> dict[str, Any]:
        request = GeminiRoutingInput(prompt=prompt, category=category)
        prompt_text = request.prompt.strip()

        if not self.api_key:
            fallback = self._heuristic_fallback(
                prompt=prompt_text,
                category=request.category,
                fallback_reason="Gemini API key missing; returned safe local fallback.",
            )
            return fallback.model_dump()

        gemini_payload = self._build_payload(prompt=prompt_text, category=request.category)
        try:
            raw_text = self.transport.generate_json(
                api_key=self.api_key,
                model=self.model,
                payload=gemini_payload,
                timeout_s=self.timeout_s,
            )
            raw_obj = self._parse_json_object(raw_text)
            validated = GeminiRoutingOutput.model_validate(raw_obj)
        except (RuntimeError, ValidationError, json.JSONDecodeError, ValueError, TypeError) as exc:
            fallback = self._heuristic_fallback(
                prompt=prompt_text,
                category=request.category,
                fallback_reason=f"Gemini JSON parsing/validation failed: {exc}",
            )
            return fallback.model_dump()

        normalized = self._normalize_output(
            output=validated,
            prompt=prompt_text,
            category=request.category,
        )
        return normalized.model_dump()

    def _build_payload(self, *, prompt: str, category: Category) -> dict[str, Any]:
        user_text = f"Category: {category.value}\nPrompt: {prompt}"
        return {
            "system_instruction": {
                "parts": [{"text": ROUTER_SYSTEM_PROMPT}],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_text}],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "topK": 20,
                "topP": 0.9,
                "maxOutputTokens": 512,
                "responseMimeType": "application/json",
                "responseSchema": ROUTER_RESPONSE_SCHEMA,
            },
        }

    def _parse_json_object(self, text: str) -> dict[str, Any]:
        stripped = text.strip()
        try:
            parsed = json.loads(stripped)
            if not isinstance(parsed, dict):
                raise ValueError("Gemini JSON root must be an object.")
            return parsed
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise
            parsed = json.loads(stripped[start : end + 1])
            if not isinstance(parsed, dict):
                raise ValueError("Extracted Gemini JSON root must be an object.")
            return parsed

    def _normalize_output(
        self,
        *,
        output: GeminiRoutingOutput,
        prompt: str,
        category: Category,
    ) -> GeminiRoutingOutput:
        text = prompt.lower()

        # Hard safety overrides from policy, regardless of model response quality.
        if _looks_like_browser_task(text):
            output.needs_browser = True
            output.intent = "browser_action"
        if _looks_like_approval_task(text):
            output.needs_approval = True

        if category == Category.RESEARCH and not output.needs_browser:
            if _looks_like_high_complexity_research(text):
                output.needs_reasoning = True
                output.intent = "multi_step_reasoning"
            elif output.intent == "answer_direct" and not output.needs_reasoning:
                output.intent = "grounded_research"
                output.reason = (
                    output.reason or "Research: defaulted to grounded_research in normalization."
                )

        if output.needs_reasoning and not output.needs_browser:
            output.intent = "multi_step_reasoning"

        if output.confidence is None:
            # Defensive guard: pydantic validator sets default, but we keep this explicit.
            output.confidence = 0.35

        return output

    def _heuristic_fallback(
        self,
        *,
        prompt: str,
        category: Category,
        fallback_reason: str,
    ) -> GeminiRoutingOutput:
        text = prompt.lower()
        needs_browser = _looks_like_browser_task(text)
        needs_approval = _looks_like_approval_task(text)

        if needs_browser:
            return GeminiRoutingOutput(
                intent="browser_action",
                confidence=0.45,
                needs_reasoning=False,
                needs_browser=True,
                needs_approval=needs_approval,
                answer="",
                evidence=[],
                missing_info=[],
                reason=fallback_reason,
            )

        if category == Category.RESEARCH:
            if _looks_like_high_complexity_research(text):
                return GeminiRoutingOutput(
                    intent="multi_step_reasoning",
                    confidence=0.4,
                    needs_reasoning=True,
                    needs_browser=False,
                    needs_approval=needs_approval,
                    answer="",
                    evidence=[],
                    missing_info=["Cross-source synthesis details"],
                    reason=fallback_reason,
                )
            return GeminiRoutingOutput(
                intent="grounded_research",
                confidence=0.55,
                needs_reasoning=False,
                needs_browser=False,
                needs_approval=needs_approval,
                answer="",
                evidence=[],
                missing_info=[],
                reason=fallback_reason,
            )

        if category == Category.TASK and _looks_like_high_complexity_research(text):
            return GeminiRoutingOutput(
                intent="multi_step_reasoning",
                confidence=0.4,
                needs_reasoning=True,
                needs_browser=False,
                needs_approval=needs_approval,
                answer="",
                evidence=[],
                missing_info=["Detailed constraints for planning"],
                reason=fallback_reason,
            )

        return GeminiRoutingOutput(
            intent="answer_direct",
            confidence=0.6,
            needs_reasoning=False,
            needs_browser=False,
            needs_approval=needs_approval,
            answer="",
            evidence=[],
            missing_info=[],
            reason=fallback_reason,
        )


def _extract_candidate_text(response_data: dict[str, Any]) -> str:
    candidates = response_data.get("candidates", [])
    if not candidates:
        return ""
    first = candidates[0]
    content = first.get("content", {})
    parts = content.get("parts", [])
    if not parts:
        return ""
    text = parts[0].get("text")
    return text if isinstance(text, str) else ""


def _looks_like_browser_task(text: str) -> bool:
    browser_terms = [
        "click",
        "log in",
        "login",
        "navigate",
        "open the website",
        "open website",
        "live site",
        "extract from",
        "scrape",
        "fill out",
        "fill form",
        "submit form",
        "dom",
        "checkout",
    ]
    return any(term in text for term in browser_terms)


def _looks_like_approval_task(text: str) -> bool:
    approval_terms = [
        "buy",
        "purchase",
        "checkout",
        "subscribe",
        "subscription",
        "upgrade plan",
        "downgrade plan",
        "transfer funds",
        "send money",
        "wire transfer",
        "top up",
        "add funds",
        "modify account",
        "change password",
        "update email",
        "close account",
        "delete account",
    ]
    return any(term in text for term in approval_terms)


def _looks_like_high_complexity_research(text: str) -> bool:
    complexity_terms = [
        "multi-country",
        "across countries",
        "cross-border",
        "legal",
        "regulatory",
        "compliance",
        "highly analytical",
        "cross-source",
        "synthesis",
        "comprehensive",
        "framework",
        "trade-off",
        "tradeoff",
    ]
    return any(term in text for term in complexity_terms)
