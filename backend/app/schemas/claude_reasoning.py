from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClaudeReasoningRequest(BaseModel):
    user_prompt: str = Field(min_length=1)
    category: str = Field(min_length=1)
    router_output: dict[str, Any] = Field(default_factory=dict)
    evidence: list[str] = Field(default_factory=list)

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, value: Any) -> str:
        return str(value).strip().lower()

    @field_validator("evidence", mode="before")
    @classmethod
    def normalize_evidence(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [str(value).strip()]


class ClaudeSynthesisOutput(BaseModel):
    """Final synthesized response object returned by the Claude fallback layer."""

    model_config = ConfigDict(extra="ignore")

    final_answer: str = ""
    summary: str = ""
    key_points: list[str] = Field(default_factory=list)
    risks_or_uncertainties: list[str] = Field(default_factory=list)
    citations_or_evidence_used: list[str] = Field(default_factory=list)
    requires_user_followup: bool = False

    @field_validator("key_points", "risks_or_uncertainties", "citations_or_evidence_used", mode="before")
    @classmethod
    def normalize_lists(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [str(value).strip()]

