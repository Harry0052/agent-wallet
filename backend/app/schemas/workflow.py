from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


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


class RouterResponse(BaseModel):
    """Canonical router output contract returned by every workflow."""

    intent: IntentLiteral = "answer_direct"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_reasoning: bool = False
    needs_browser: bool = False
    needs_approval: bool = False
    answer: str = ""
    evidence: list[str] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)
    reason: str = ""


class ExecuteRequest(BaseModel):
    prompt: str = Field(min_length=1)
    category: Category
    approved: bool = False
