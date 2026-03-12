from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RouteTaken = Literal[
    "gemini_direct",
    "gemini_research",
    "claude_reasoning",
    "agentql_execution",
    "approval_required",
]


class OrchestratorRequest(BaseModel):
    prompt: str = Field(min_length=1)
    category: str = Field(min_length=1)
    approval_granted: bool = False
    browser_execution_request: dict[str, Any] = Field(default_factory=dict)

    @field_validator("prompt", "category", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> str:
        return str(value).strip()

    @field_validator("category", mode="after")
    @classmethod
    def normalize_category(cls, value: str) -> str:
        return value.lower()


class OrchestratorResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    route_taken: RouteTaken = "gemini_direct"
    router_output: dict[str, Any] = Field(default_factory=dict)
    reasoning_output: dict[str, Any] = Field(default_factory=dict)
    execution_output: dict[str, Any] = Field(default_factory=dict)
    user_facing_message: str = ""
    success: bool = True
    error: str = ""

