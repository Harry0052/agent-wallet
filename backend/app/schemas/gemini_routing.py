from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Category(str, Enum):
    GENERAL = "general"
    RESEARCH = "research"
    TASK = "task"


IntentLiteral = Literal[
    "answer_direct",
    "grounded_research",
    "multi_step_reasoning",
    "browser_action",
]


SAFE_DEFAULT_CONFIDENCE = 0.35


class GeminiRoutingInput(BaseModel):
    prompt: str = Field(min_length=1)
    category: Category


class GeminiRoutingOutput(BaseModel):
    """Normalized routing object used by orchestration layers."""

    model_config = ConfigDict(extra="ignore")

    intent: IntentLiteral = "answer_direct"
    confidence: Optional[float] = None
    needs_reasoning: bool = False
    needs_browser: bool = False
    needs_approval: bool = False
    answer: str = ""
    evidence: list[str] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)
    reason: str = ""

    @field_validator("confidence", mode="before")
    @classmethod
    def normalize_confidence(cls, value: Any) -> float:
        if value is None or value == "":
            return SAFE_DEFAULT_CONFIDENCE
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return SAFE_DEFAULT_CONFIDENCE
        return max(0.0, min(1.0, parsed))

    @field_validator("evidence", "missing_info", mode="before")
    @classmethod
    def normalize_list_fields(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item) for item in value if str(item).strip()]
        return [str(value)]

    @model_validator(mode="after")
    def enforce_logical_consistency(self) -> "GeminiRoutingOutput":
        if self.needs_browser:
            self.intent = "browser_action"
        elif self.needs_reasoning and self.intent != "multi_step_reasoning":
            self.intent = "multi_step_reasoning"

        # In research mode we should not default to answer_direct.
        if self.intent == "answer_direct" and self.reason.lower().startswith("research:"):
            self.intent = "grounded_research"

        return self
