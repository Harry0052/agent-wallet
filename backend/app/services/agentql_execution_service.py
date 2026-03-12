from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, Protocol
from uuid import uuid4

from pydantic import ValidationError

from app.schemas.agentql_execution import AgentQLExecutionRequest, AgentQLExecutionResult, AgentQLStep


class AgentQLTransport(Protocol):
    """Transport contract for remote browser automation providers."""

    def start_session(self, *, base_url: str) -> str:
        ...

    def navigate(self, *, session_id: str, url: str) -> None:
        ...

    def click(self, *, session_id: str, selector: str) -> None:
        ...

    def type(self, *, session_id: str, selector: str, text: str) -> None:
        ...

    def extract(self, *, session_id: str, fields: list[str]) -> dict[str, Any]:
        ...

    def get_current_url(self, *, session_id: str) -> str:
        ...

    def close_session(self, *, session_id: str) -> None:
        ...


@dataclass
class AgentQLRemoteTransport:
    """Stub AgentQL remote transport.

    TODO:
    - Wire real AgentQL authentication and session APIs.
    - Replace selector calls with real page-object selectors.
    - Add retries and network telemetry for production reliability.
    """

    api_key: str = ""
    endpoint: str = "https://api.agentql.com"
    _sessions: dict[str, str] = field(default_factory=dict)

    def start_session(self, *, base_url: str) -> str:
        session_id = f"agentql-{uuid4().hex[:10]}"
        self._sessions[session_id] = base_url
        return session_id

    def navigate(self, *, session_id: str, url: str) -> None:
        self._require_session(session_id=session_id)
        self._sessions[session_id] = url

    def click(self, *, session_id: str, selector: str) -> None:
        self._require_session(session_id=session_id)
        if not selector.strip():
            raise RuntimeError("Selector is required for click action.")

    def type(self, *, session_id: str, selector: str, text: str) -> None:
        self._require_session(session_id=session_id)
        if not selector.strip():
            raise RuntimeError("Selector is required for type/fill action.")
        if text is None:
            raise RuntimeError("Text payload is required for type/fill action.")

    def extract(self, *, session_id: str, fields: list[str]) -> dict[str, Any]:
        self._require_session(session_id=session_id)
        output = {}
        for key in fields:
            output[key] = f"TODO_SELECTOR_REQUIRED::{key}"
        return output

    def get_current_url(self, *, session_id: str) -> str:
        self._require_session(session_id=session_id)
        return self._sessions[session_id]

    def close_session(self, *, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _require_session(self, *, session_id: str) -> None:
        if session_id not in self._sessions:
            raise RuntimeError("AgentQL session not found.")


class AgentQLExecutionService:
    """Planner + executor for browser-only workflows."""

    def __init__(
        self,
        *,
        transport: Optional[AgentQLTransport] = None,
    ) -> None:
        self.transport = transport or AgentQLRemoteTransport()

    def planner(self, request: AgentQLExecutionRequest) -> AgentQLExecutionResult:
        """Create a dry-run execution plan without browser actions."""
        try:
            normalized_steps = self._normalize_steps(request=request)
        except (ValueError, ValidationError) as exc:
            return AgentQLExecutionResult(
                status="failed",
                error=f"Invalid execution request: {exc}",
            )

        if self._is_simple_research_request(request=request):
            return AgentQLExecutionResult(
                status="failed",
                error="Browser execution is blocked for simple research/information lookup requests.",
            )

        logs = []
        for idx, step in enumerate(normalized_steps, start=1):
            checkpoint = self._should_pause_before_step(request=request, step=step)
            logs.append(
                self._build_log_entry(
                    phase="planning",
                    step_index=idx,
                    action=step.action,
                    status="planned",
                    message=f"Planned step: {step.description or step.action}",
                    target=step.target,
                    checkpoint=checkpoint,
                )
            )

        return AgentQLExecutionResult(
            status="planned",
            executed_steps=logs,
            extracted_data={},
            approval_checkpoint_reached=any(log.get("checkpoint") for log in logs),
            final_url=request.site,
            error="",
        )

    def executor(
        self,
        request: AgentQLExecutionRequest,
        *,
        dry_run: bool = False,
        approval_granted: bool = False,
    ) -> AgentQLExecutionResult:
        """Execute planned steps against AgentQL transport."""
        if dry_run:
            return self.planner(request=request)

        try:
            normalized_steps = self._normalize_steps(request=request)
        except (ValueError, ValidationError) as exc:
            return AgentQLExecutionResult(
                status="failed",
                error=f"Invalid execution request: {exc}",
            )

        if self._is_simple_research_request(request=request):
            return AgentQLExecutionResult(
                status="failed",
                error="Browser execution is blocked for simple research/information lookup requests.",
            )

        result = AgentQLExecutionResult(status="running", final_url=request.site)
        session_id = ""
        try:
            session_id = self.transport.start_session(base_url=request.site)
            result.final_url = self.transport.get_current_url(session_id=session_id)

            for idx, step in enumerate(normalized_steps, start=1):
                if self._should_pause_before_step(request=request, step=step) and not approval_granted:
                    result.executed_steps.append(
                        self._build_log_entry(
                            phase="checkpoint",
                            step_index=idx,
                            action=step.action,
                            status="paused",
                            message="Approval checkpoint reached before irreversible action.",
                            target=step.target,
                            checkpoint=True,
                        )
                    )
                    result.status = "paused_for_approval"
                    result.approval_checkpoint_reached = True
                    result.final_url = self.transport.get_current_url(session_id=session_id)
                    return result

                result.executed_steps.append(
                    self._build_log_entry(
                        phase="execution",
                        step_index=idx,
                        action=step.action,
                        status="running",
                        message=f"Executing step {idx}",
                        target=step.target,
                    )
                )

                extracted = self._execute_step(
                    session_id=session_id,
                    step=step,
                    request=request,
                )
                if extracted:
                    result.extracted_data.update(extracted)

                result.final_url = self.transport.get_current_url(session_id=session_id)
                result.executed_steps.append(
                    self._build_log_entry(
                        phase="execution",
                        step_index=idx,
                        action=step.action,
                        status="completed",
                        message=f"Step {idx} completed.",
                        target=step.target,
                    )
                )

            result.status = "completed"
            return result
        except Exception as exc:  # noqa: BLE001 - explicit catch for structured failure output
            result.status = "failed"
            result.error = str(exc)
            if session_id:
                try:
                    result.final_url = self.transport.get_current_url(session_id=session_id)
                except Exception:  # noqa: BLE001
                    pass
            result.executed_steps.append(
                self._build_log_entry(
                    phase="error",
                    step_index=len(result.executed_steps) + 1,
                    action="error",
                    status="failed",
                    message=f"Execution failed: {exc}",
                    target="",
                )
            )
            return result
        finally:
            if session_id:
                # TODO: Keep session open + persist session id when implementing resume flows.
                self.transport.close_session(session_id=session_id)

    def _normalize_steps(self, *, request: AgentQLExecutionRequest) -> list[AgentQLStep]:
        steps: list[AgentQLStep] = []
        if request.steps:
            for raw in request.steps:
                if isinstance(raw, AgentQLStep):
                    step = raw
                elif isinstance(raw, dict):
                    step = AgentQLStep.model_validate(raw)
                elif isinstance(raw, str):
                    step = self._parse_text_step(raw)
                else:
                    raise ValueError(f"Unsupported step format: {type(raw)}")

                if step.action not in request.allowed_actions:
                    raise ValueError(f"Step action '{step.action}' is not in allowed_actions.")
                steps.append(step)

        if not steps:
            steps.append(
                AgentQLStep(
                    action="navigate",
                    target=request.site,
                    description="Auto-generated navigation step.",
                )
            )

        has_extract_step = any(step.action == "extract" for step in steps)
        if request.data_to_extract and not has_extract_step:
            steps.append(
                AgentQLStep(
                    action="extract",
                    target=", ".join(request.data_to_extract),
                    description="Auto-generated extract step from request.data_to_extract.",
                )
            )

        return steps

    def _parse_text_step(self, step_text: str) -> AgentQLStep:
        normalized = step_text.strip()
        lowered = normalized.lower()

        if "log in" in lowered or "login" in lowered:
            return AgentQLStep(action="login", description=normalized, target="TODO_LOGIN_SELECTOR")
        if "navigate" in lowered or "go to" in lowered or "open " in lowered:
            return AgentQLStep(action="navigate", description=normalized, target=self._extract_target(normalized))
        if "click" in lowered:
            return AgentQLStep(action="click", description=normalized, target=self._extract_target(normalized))
        if "fill" in lowered or "type" in lowered:
            return AgentQLStep(
                action="fill",
                description=normalized,
                target=self._extract_target(normalized),
                value="TODO_INPUT_VALUE",
            )
        if "extract" in lowered:
            return AgentQLStep(action="extract", description=normalized, target=self._extract_target(normalized))
        if "wait" in lowered:
            return AgentQLStep(action="wait", description=normalized, target="")
        if any(token in lowered for token in ["checkout", "purchase", "confirm", "submit", "cancel"]):
            return AgentQLStep(
                action="click",
                description=normalized,
                target=self._extract_target(normalized),
                irreversible=True,
            )
        return AgentQLStep(action="click", description=normalized, target=self._extract_target(normalized))

    def _execute_step(
        self,
        *,
        session_id: str,
        step: AgentQLStep,
        request: AgentQLExecutionRequest,
    ) -> dict[str, Any]:
        action = step.action

        if action == "navigate":
            target = step.target or request.site
            self.transport.navigate(session_id=session_id, url=target)
            return {}

        if action == "click":
            self.transport.click(session_id=session_id, selector=step.target)
            return {}

        if action in {"type", "fill"}:
            self.transport.type(session_id=session_id, selector=step.target, text=step.value)
            return {}

        if action == "login":
            # TODO: Replace with secure credential injection (vault/secret manager).
            self.transport.type(session_id=session_id, selector="TODO_USERNAME_SELECTOR", text="TODO_USERNAME")
            self.transport.type(session_id=session_id, selector="TODO_PASSWORD_SELECTOR", text="TODO_PASSWORD")
            self.transport.click(session_id=session_id, selector="TODO_LOGIN_SUBMIT_SELECTOR")
            return {}

        if action == "extract":
            fields = request.data_to_extract or [item.strip() for item in step.target.split(",") if item.strip()]
            if not fields:
                fields = ["default_field"]
            return self.transport.extract(session_id=session_id, fields=fields)

        if action == "wait":
            return {}

        raise RuntimeError(f"Unsupported action '{action}'.")

    def _should_pause_before_step(self, *, request: AgentQLExecutionRequest, step: AgentQLStep) -> bool:
        if not request.stop_before_commit:
            return False

        sensitive_goal = self._is_financial_or_account_goal(request.goal)
        commit_like_step = step.irreversible or self._is_commit_like_step(step)
        if not commit_like_step:
            return False
        return request.needs_approval or sensitive_goal or step.irreversible

    def _is_simple_research_request(self, *, request: AgentQLExecutionRequest) -> bool:
        goal = request.goal.lower()
        raw_steps_text = " ".join(str(step) for step in request.steps).lower()
        research_tokens = ["what is", "research", "explain", "summarize", "compare", "latest"]
        browser_tokens = ["click", "login", "log in", "fill", "extract", "dashboard", "checkout", "navigate"]
        has_research_goal = any(token in goal for token in research_tokens)
        has_explicit_browser_steps = any(token in raw_steps_text for token in browser_tokens)
        has_browser_goal = any(token in goal for token in browser_tokens)
        has_extract_request = bool(request.data_to_extract)
        return has_research_goal and not has_explicit_browser_steps and not has_browser_goal and not has_extract_request

    @staticmethod
    def _is_financial_or_account_goal(goal: str) -> bool:
        lowered = goal.lower()
        tokens = [
            "purchase",
            "checkout",
            "pay",
            "transfer funds",
            "booking",
            "subscription",
            "account setting",
            "change plan",
            "wallet",
        ]
        return any(token in lowered for token in tokens)

    @staticmethod
    def _is_commit_like_step(step: AgentQLStep) -> bool:
        text = f"{step.action} {step.target} {step.description}".lower()
        commit_tokens = [
            "checkout",
            "purchase",
            "pay",
            "confirm",
            "submit",
            "place order",
            "transfer",
            "cancel",
            "save settings",
            "delete",
        ]
        return any(token in text for token in commit_tokens)

    @staticmethod
    def _extract_target(text: str) -> str:
        if ":" in text:
            return text.split(":", 1)[1].strip()
        return text.strip()

    @staticmethod
    def _build_log_entry(
        *,
        phase: str,
        step_index: int,
        action: str,
        status: str,
        message: str,
        target: str,
        checkpoint: bool = False,
    ) -> dict[str, Any]:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "phase": phase,
            "step_index": step_index,
            "action": action,
            "target": target,
            "status": status,
            "checkpoint": checkpoint,
            "message": message,
        }


def plan_agentql_execution(execution_request: dict[str, Any]) -> dict[str, Any]:
    """Planner function: build safe dry-run plan only."""
    request = AgentQLExecutionRequest.model_validate(execution_request)
    service = AgentQLExecutionService()
    return service.planner(request=request).model_dump()


def execute_agentql_execution(
    execution_request: dict[str, Any],
    *,
    dry_run: bool = False,
    approval_granted: bool = False,
) -> dict[str, Any]:
    """Executor function: run or dry-run an AgentQL flow."""
    request = AgentQLExecutionRequest.model_validate(execution_request)
    service = AgentQLExecutionService()
    return service.executor(
        request=request,
        dry_run=dry_run,
        approval_granted=approval_granted,
    ).model_dump()
