from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ApprovalType = Literal["financial", "account_change", "external_commitment", "none"]


class ApprovalGateRequest(BaseModel):
    original_user_prompt: str = Field(min_length=1)
    router_intent: str = ""
    execution_plan: Any = Field(default_factory=dict)
    category: str = ""

    @field_validator("original_user_prompt", "router_intent", "category", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> str:
        return str(value).strip()


class ApprovalGateDecision(BaseModel):
    model_config = ConfigDict(extra="ignore")

    needs_approval: bool = True
    approval_reason: str = ""
    approval_type: ApprovalType = "none"
    safe_to_continue_without_approval: bool = False

