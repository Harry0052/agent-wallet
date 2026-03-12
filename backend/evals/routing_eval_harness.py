from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Protocol, Sequence, Tuple

from evals.routing_eval_dataset import ROUTING_EVAL_DATASET, RouteLabel, RoutingEvalExample

ROUTE_ORDER: List[RouteLabel] = [
    "answer_direct",
    "grounded_research",
    "multi_step_reasoning",
    "browser_action",
]


class RouterCallable(Protocol):
    def __call__(self, prompt: str, category: str) -> dict[str, Any]:
        ...


@dataclass
class EvalRecord:
    example: RoutingEvalExample
    predicted_route: str
    predicted_needs_approval: bool
    confidence: float
    raw_output: dict[str, Any]


def evaluate_router(
    router_fn: RouterCallable,
    dataset: Sequence[RoutingEvalExample] = ROUTING_EVAL_DATASET,
) -> dict[str, Any]:
    records: List[EvalRecord] = []
    for example in dataset:
        output = router_fn(example.prompt, example.category) or {}
        predicted_route = str(output.get("intent", "")).strip()
        predicted_needs_approval = bool(output.get("needs_approval", False))
        confidence = _safe_float(output.get("confidence", 0.0))
        records.append(
            EvalRecord(
                example=example,
                predicted_route=predicted_route,
                predicted_needs_approval=predicted_needs_approval,
                confidence=confidence,
                raw_output=output,
            )
        )

    route_accuracy = _mean([rec.predicted_route == rec.example.expected_route for rec in records])
    approval_accuracy = _mean(
        [rec.predicted_needs_approval == rec.example.expected_needs_approval for rec in records]
    )
    confusion = build_confusion_matrix(records)
    browser_fp, browser_fn = browser_routing_failures(records)
    approval_fp, approval_fn = approval_failures(records)
    threshold_recommendations = recommend_confidence_thresholds(records)

    return {
        "num_examples": len(records),
        "route_accuracy": round(route_accuracy, 4),
        "approval_accuracy": round(approval_accuracy, 4),
        "confusion_matrix": confusion,
        "browser_false_positives": browser_fp,
        "browser_false_negatives": browser_fn,
        "approval_false_positives": approval_fp,
        "approval_false_negatives": approval_fn,
        "threshold_recommendations": threshold_recommendations,
    }


def build_confusion_matrix(records: Sequence[EvalRecord]) -> dict[str, dict[str, int]]:
    matrix: Dict[str, Dict[str, int]] = {
        expected: {predicted: 0 for predicted in ROUTE_ORDER} for expected in ROUTE_ORDER
    }
    for record in records:
        expected = record.example.expected_route
        predicted = record.predicted_route if record.predicted_route in ROUTE_ORDER else "answer_direct"
        matrix[expected][predicted] += 1
    return matrix


def format_confusion_matrix(matrix: dict[str, dict[str, int]]) -> str:
    headers = ["expected\\predicted"] + ROUTE_ORDER
    rows = [" | ".join(headers)]
    rows.append("-" * len(rows[0]))
    for expected in ROUTE_ORDER:
        row_values = [expected] + [str(matrix[expected][pred]) for pred in ROUTE_ORDER]
        rows.append(" | ".join(row_values))
    return "\n".join(rows)


def browser_routing_failures(records: Sequence[EvalRecord]) -> Tuple[List[dict[str, Any]], List[dict[str, Any]]]:
    false_positives: List[dict[str, Any]] = []
    false_negatives: List[dict[str, Any]] = []
    for rec in records:
        expected_browser = rec.example.expected_route == "browser_action"
        predicted_browser = rec.predicted_route == "browser_action"
        if predicted_browser and not expected_browser:
            false_positives.append(_failure_row(rec))
        if expected_browser and not predicted_browser:
            false_negatives.append(_failure_row(rec))
    return false_positives, false_negatives


def approval_failures(records: Sequence[EvalRecord]) -> Tuple[List[dict[str, Any]], List[dict[str, Any]]]:
    false_positives: List[dict[str, Any]] = []
    false_negatives: List[dict[str, Any]] = []
    for rec in records:
        expected = rec.example.expected_needs_approval
        predicted = rec.predicted_needs_approval
        if predicted and not expected:
            false_positives.append(_failure_row(rec))
        if expected and not predicted:
            false_negatives.append(_failure_row(rec))
    return false_positives, false_negatives


def recommend_confidence_thresholds(records: Sequence[EvalRecord]) -> dict[str, Any]:
    """Grid-search simple thresholds for escalating low-confidence non-browser responses."""
    candidates = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]
    categories = ["general", "research", "task"]
    output: dict[str, Any] = {}

    for category in categories:
        category_records = [rec for rec in records if rec.example.category == category]
        if not category_records:
            continue

        best = {
            "threshold": candidates[0],
            "accuracy": -1.0,
            "escalation_rate": 0.0,
            "objective": -999.0,
        }
        for threshold in candidates:
            adjusted_routes = [_apply_threshold(rec, threshold) for rec in category_records]
            accuracy = _mean(
                [
                    adjusted_routes[idx] == category_records[idx].example.expected_route
                    for idx in range(len(category_records))
                ]
            )
            escalation_rate = _mean(
                [adjusted_routes[idx] == "multi_step_reasoning" for idx in range(len(category_records))]
            )
            objective = accuracy - 0.10 * escalation_rate
            if objective > best["objective"]:
                best = {
                    "threshold": threshold,
                    "accuracy": round(accuracy, 4),
                    "escalation_rate": round(escalation_rate, 4),
                    "objective": round(objective, 4),
                }

        output[category] = best
    return output


def _apply_threshold(record: EvalRecord, threshold: float) -> str:
    route = record.predicted_route
    if route in {"answer_direct", "grounded_research"} and record.confidence < threshold:
        return "multi_step_reasoning"
    return route


def _failure_row(record: EvalRecord) -> dict[str, Any]:
    return {
        "id": record.example.id,
        "category": record.example.category,
        "prompt": record.example.prompt,
        "expected_route": record.example.expected_route,
        "predicted_route": record.predicted_route,
        "expected_needs_approval": record.example.expected_needs_approval,
        "predicted_needs_approval": record.predicted_needs_approval,
        "confidence": record.confidence,
    }


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _mean(values: Sequence[bool]) -> float:
    if not values:
        return 0.0
    return sum(1.0 for value in values if value) / float(len(values))


def run_eval_with_router(router_fn: RouterCallable) -> dict[str, Any]:
    report = evaluate_router(router_fn=router_fn, dataset=ROUTING_EVAL_DATASET)
    print(f"Route accuracy: {report['route_accuracy']}")
    print(f"Approval accuracy: {report['approval_accuracy']}")
    print(format_confusion_matrix(report["confusion_matrix"]))
    print(f"Browser FP examples: {len(report['browser_false_positives'])}")
    print(f"Browser FN examples: {len(report['browser_false_negatives'])}")
    print(f"Approval FP examples: {len(report['approval_false_positives'])}")
    print(f"Approval FN examples: {len(report['approval_false_negatives'])}")
    print(f"Recommended thresholds: {report['threshold_recommendations']}")
    return report


def build_oracle_router() -> Callable[[str, str], dict[str, Any]]:
    index = {(item.prompt, item.category): item for item in ROUTING_EVAL_DATASET}

    def _oracle(prompt: str, category: str) -> dict[str, Any]:
        item = index[(prompt, category)]
        return {
            "intent": item.expected_route,
            "needs_approval": item.expected_needs_approval,
            "confidence": 0.95,
        }

    return _oracle

