from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ExecutionStatus = Literal["planned", "running", "paused_for_approval", "completed", "failed"]


class AgentQLStep(BaseModel):
    model_config = ConfigDict(extra="ignore")

    action: str = Field(min_length=1)
    target: str = ""
    value: str = ""
    description: str = ""
    irreversible: bool = False

    @field_validator("action", mode="before")
    @classmethod
    def normalize_action(cls, value: Any) -> str:
        return str(value).strip().lower()

    @model_validator(mode="after")
    def infer_irreversible_flag(self) -> "AgentQLStep":
        text = f"{self.action} {self.target} {self.description} {self.value}".lower()
        irreversible_tokens = [
            "checkout",
            "purchase",
            "pay",
            "confirm",
            "submit",
            "place order",
            "transfer",
            "cancel subscription",
            "save settings",
            "delete",
        ]
        if any(token in text for token in irreversible_tokens):
            self.irreversible = True
        return self


class AgentQLExecutionRequest(BaseModel):
    goal: str = Field(min_length=1)
    site: str = Field(min_length=1)
    steps: list[Any] = Field(default_factory=list)
    needs_approval: bool = False
    allowed_actions: list[str] = Field(default_factory=list)
    data_to_extract: list[str] = Field(default_factory=list)
    stop_before_commit: bool = True

    @field_validator("goal", "site", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> str:
        return str(value).strip()

    @field_validator("allowed_actions", mode="before")
    @classmethod
    def normalize_allowed_actions(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip().lower() for item in value if str(item).strip()]
        return [str(value).strip().lower()]

    @field_validator("data_to_extract", mode="before")
    @classmethod
    def normalize_extract_fields(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [str(value).strip()]

    @model_validator(mode="after")
    def set_default_allowed_actions(self) -> "AgentQLExecutionRequest":
        if not self.allowed_actions:
            self.allowed_actions = [
                "navigate",
                "click",
                "type",
                "fill",
                "extract",
                "wait",
                "login",
                "checkpoint",
            ]
        return self


class AgentQLExecutionResult(BaseModel):
    status: ExecutionStatus = "planned"
    executed_steps: list[dict[str, Any]] = Field(default_factory=list)
    extracted_data: dict[str, Any] = Field(default_factory=dict)
    approval_checkpoint_reached: bool = False
    final_url: str = ""
    error: str = ""

