from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Tuple
from uuid import uuid4

from app.schemas.approval_gate import ApprovalGateDecision, ApprovalGateRequest

MatchMap = Dict[str, List[str]]
DetectorFunc = Callable[["ApprovalContext"], Tuple[bool, MatchMap, str]]


FINANCIAL_KEYWORDS = [
    "purchase",
    "buy",
    "checkout",
    "place order",
    "payment",
    "pay",
    "transfer",
    "transfer funds",
    "send money",
    "wire",
    "top up",
    "add funds",
    "wallet transfer",
    "subscription",
    "subscribe",
    "renew plan",
    "upgrade plan",
    "downgrade plan",
]

ACCOUNT_CHANGE_KEYWORDS = [
    "account settings",
    "settings",
    "change password",
    "update email",
    "update profile",
    "change security",
    "enable 2fa",
    "disable 2fa",
    "close account",
    "delete account",
    "reset account",
    "revoke access",
    "permissions",
]

EXTERNAL_COMMITMENT_KEYWORDS = [
    "confirm booking",
    "booking confirmation",
    "book now",
    "confirm reservation",
    "send email",
    "send message",
    "post message",
    "submit application",
    "publish",
    "delete data",
    "erase data",
    "remove data",
    "final submit",
    "final confirmation",
]

COMMIT_ACTION_KEYWORDS = [
    "confirm",
    "submit",
    "place order",
    "checkout",
    "purchase",
    "pay",
    "transfer",
    "cancel subscription",
    "delete",
    "save settings",
]

READ_ONLY_ACTIONS = {"navigate", "open", "wait", "extract", "view", "login"}

APPROVAL_REQUIRED_PROMPTS = [
    "Buy the pro plan and checkout.",
    "Transfer funds from wallet A to wallet B.",
    "Top up my account balance by $50.",
    "Cancel my subscription and confirm.",
    "Confirm this hotel booking.",
    "Change my account email and password.",
    "Delete my stored customer data.",
    "Send an email to all customers.",
]

APPROVAL_NOT_REQUIRED_PROMPTS = [
    "Research payment orchestration trends.",
    "Summarize these invoices.",
    "Log in and extract invoice data only.",
    "Open dashboard and read monthly usage metrics.",
]


@dataclass(frozen=True)
class ApprovalRule:
    rule_id: str
    approval_type: str
    detector: DetectorFunc
    summary: str


@dataclass
class ApprovalContext:
    prompt: str
    router_intent: str
    category: str
    plan_text: str
    step_actions: List[str]
    plan_has_irreversible_flag: bool
    plan_has_commit_markers: bool

    @property
    def source_map(self) -> Dict[str, str]:
        return {
            "prompt": self.prompt,
            "router_intent": self.router_intent,
            "category": self.category,
            "execution_plan": self.plan_text,
        }


class ApprovalGateEngine:
    """Strict, explainable rule engine for approval gating."""

    def __init__(self) -> None:
        self.rules = [
            ApprovalRule(
                rule_id="R_FINANCIAL",
                approval_type="financial",
                detector=_detect_financial_rule,
                summary="Financial side effect detected.",
            ),
            ApprovalRule(
                rule_id="R_ACCOUNT_CHANGE",
                approval_type="account_change",
                detector=_detect_account_change_rule,
                summary="Account-changing operation detected.",
            ),
            ApprovalRule(
                rule_id="R_EXTERNAL_COMMITMENT",
                approval_type="external_commitment",
                detector=_detect_external_commitment_rule,
                summary="External real-world side effect detected.",
            ),
        ]

    def evaluate(
        self,
        *,
        original_user_prompt: str,
        router_intent: str,
        execution_plan: Any,
        category: str,
    ) -> dict[str, Any]:
        request = ApprovalGateRequest(
            original_user_prompt=original_user_prompt,
            router_intent=router_intent,
            execution_plan=execution_plan,
            category=category,
        )
        context = _build_context(request=request)

        for rule in self.rules:
            triggered, matches, extra = rule.detector(context)
            if triggered:
                reason = _format_reason(
                    rule_id=rule.rule_id,
                    rule_summary=rule.summary,
                    matches=matches,
                    extra=extra,
                )
                decision = ApprovalGateDecision(
                    needs_approval=True,
                    approval_reason=reason,
                    approval_type=rule.approval_type,  # type: ignore[arg-type]
                    safe_to_continue_without_approval=False,
                )
                return decision.model_dump()

        decision = ApprovalGateDecision(
            needs_approval=False,
            approval_reason="No approval rule triggered; workflow appears read-only/reversible.",
            approval_type="none",
            safe_to_continue_without_approval=True,
        )
        return decision.model_dump()

    def build_approval_challenge(
        self,
        decision: dict[str, Any],
        *,
        workflow_id: str,
        actor_id: str = "",
        ttl_seconds: int = 900,
    ) -> dict[str, Any]:
        """Builds a UI/API-friendly challenge payload for modal + confirmation token wiring."""
        normalized = ApprovalGateDecision.model_validate(decision)
        if not normalized.needs_approval:
            return {
                "required": False,
                "workflow_id": workflow_id,
                "approval_type": "none",
            }

        challenge_id = f"appr-{uuid4().hex[:12]}"
        modal_hint = f"{normalized.approval_type}_confirmation"
        return {
            "required": True,
            "challenge_id": challenge_id,
            "workflow_id": workflow_id,
            "actor_id": actor_id,
            "approval_type": normalized.approval_type,
            "reason": normalized.approval_reason,
            "modal_hint": modal_hint,
            "token_scope": f"workflow:{workflow_id}:{normalized.approval_type}",
            "token_ttl_seconds": ttl_seconds,
        }


def requires_approval(
    *,
    original_user_prompt: str,
    router_intent: str,
    execution_plan: Any,
    category: str,
) -> dict[str, Any]:
    engine = ApprovalGateEngine()
    return engine.evaluate(
        original_user_prompt=original_user_prompt,
        router_intent=router_intent,
        execution_plan=execution_plan,
        category=category,
    )


def _build_context(*, request: ApprovalGateRequest) -> ApprovalContext:
    plan_text_chunks = flatten_execution_plan_text(request.execution_plan)
    step_actions = extract_step_actions(request.execution_plan)
    plan_text = " ".join(plan_text_chunks).lower()
    return ApprovalContext(
        prompt=request.original_user_prompt.lower(),
        router_intent=request.router_intent.lower(),
        category=request.category.lower(),
        plan_text=plan_text,
        step_actions=step_actions,
        plan_has_irreversible_flag=plan_has_irreversible_flag(request.execution_plan),
        plan_has_commit_markers=contains_any(plan_text, COMMIT_ACTION_KEYWORDS),
    )


def flatten_execution_plan_text(execution_plan: Any) -> List[str]:
    out: List[str] = []

    def _walk(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, dict):
            for key, value in node.items():
                out.append(str(key))
                _walk(value)
            return
        if isinstance(node, (list, tuple, set)):
            for item in node:
                _walk(item)
            return
        out.append(str(node))

    _walk(execution_plan)
    return [chunk.strip() for chunk in out if chunk and str(chunk).strip()]


def extract_step_actions(execution_plan: Any) -> List[str]:
    actions: List[str] = []

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if str(key).strip().lower() == "action":
                    actions.append(str(value).strip().lower())
                _walk(value)
            return
        if isinstance(node, (list, tuple, set)):
            for item in node:
                _walk(item)

    _walk(execution_plan)
    return actions


def plan_has_irreversible_flag(execution_plan: Any) -> bool:
    flag_keys = {"irreversible", "final_submit", "final_confirmation", "commit"}

    def _walk(node: Any) -> bool:
        if isinstance(node, dict):
            for key, value in node.items():
                lowered = str(key).strip().lower()
                if lowered in flag_keys and bool(value):
                    return True
                if _walk(value):
                    return True
            return False
        if isinstance(node, (list, tuple, set)):
            for item in node:
                if _walk(item):
                    return True
        return False

    return _walk(execution_plan)


def contains_any(text: str, tokens: List[str]) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in tokens)


def is_read_only_execution(actions: List[str]) -> bool:
    if not actions:
        return True
    return all(action in READ_ONLY_ACTIONS for action in actions)


def _detect_financial_rule(context: ApprovalContext) -> Tuple[bool, MatchMap, str]:
    matches = _find_matches(context=context, keywords=FINANCIAL_KEYWORDS)
    triggered = bool(matches)
    extra = ""
    if not triggered and context.plan_has_irreversible_flag and contains_any(context.plan_text, ["subscription"]):
        triggered = True
        extra = "Irreversible subscription-related step detected in execution plan."
    return triggered, matches, extra


def _detect_account_change_rule(context: ApprovalContext) -> Tuple[bool, MatchMap, str]:
    matches = _find_matches(context=context, keywords=ACCOUNT_CHANGE_KEYWORDS)
    triggered = bool(matches)
    extra = ""
    if not triggered and context.plan_has_irreversible_flag and contains_any(context.plan_text, ["account", "settings"]):
        triggered = True
        extra = "Irreversible account/settings step detected in execution plan."
    return triggered, matches, extra


def _detect_external_commitment_rule(context: ApprovalContext) -> Tuple[bool, MatchMap, str]:
    matches = _find_matches(context=context, keywords=EXTERNAL_COMMITMENT_KEYWORDS)
    triggered = bool(matches)
    extra = ""

    if not triggered and context.plan_has_irreversible_flag:
        triggered = True
        extra = "Execution plan marks an irreversible step."

    if not triggered and context.plan_has_commit_markers and not is_read_only_execution(context.step_actions):
        triggered = True
        extra = "Commit-like action markers detected in non-read-only plan."

    return triggered, matches, extra


def _find_matches(*, context: ApprovalContext, keywords: List[str]) -> MatchMap:
    found: MatchMap = {}
    for source_name, source_text in context.source_map.items():
        matches = [keyword for keyword in keywords if keyword in source_text]
        if matches:
            found[source_name] = sorted(set(matches))
    return found


def _format_reason(*, rule_id: str, rule_summary: str, matches: MatchMap, extra: str) -> str:
    parts = [f"{rule_id}: {rule_summary}"]
    if matches:
        source_bits = []
        for source, tokens in matches.items():
            source_bits.append(f"{source}={','.join(tokens)}")
        parts.append("matched_signals: " + "; ".join(source_bits))
    if extra:
        parts.append(extra)
    return " | ".join(parts)

