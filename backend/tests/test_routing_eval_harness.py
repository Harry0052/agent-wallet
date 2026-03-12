import unittest

from evals.routing_eval_dataset import ROUTING_EVAL_DATASET
from evals.routing_eval_harness import (
    build_oracle_router,
    evaluate_router,
    format_confusion_matrix,
)


def flawed_router(prompt: str, category: str) -> dict:
    lowered = prompt.lower()
    if "research" in lowered or category == "research":
        # Intentional mistake: over-trigger browser for research.
        return {"intent": "browser_action", "needs_approval": False, "confidence": 0.9}
    if "buy" in lowered or "transfer" in lowered:
        # Intentional mistake: under-trigger approval for financial tasks.
        return {"intent": "answer_direct", "needs_approval": False, "confidence": 0.8}
    return {"intent": "answer_direct", "needs_approval": False, "confidence": 0.85}


class RoutingEvalHarnessTest(unittest.TestCase):
    def test_dataset_has_minimum_size(self) -> None:
        self.assertGreaterEqual(len(ROUTING_EVAL_DATASET), 40)

    def test_oracle_router_scores_perfectly(self) -> None:
        report = evaluate_router(router_fn=build_oracle_router(), dataset=ROUTING_EVAL_DATASET)
        self.assertEqual(report["route_accuracy"], 1.0)
        self.assertEqual(report["approval_accuracy"], 1.0)

    def test_confusion_matrix_totals_match_dataset(self) -> None:
        report = evaluate_router(router_fn=build_oracle_router(), dataset=ROUTING_EVAL_DATASET)
        matrix = report["confusion_matrix"]
        total = 0
        for expected_label in matrix:
            for predicted_label in matrix[expected_label]:
                total += matrix[expected_label][predicted_label]
        self.assertEqual(total, len(ROUTING_EVAL_DATASET))
        formatted = format_confusion_matrix(matrix)
        self.assertIn("expected\\predicted", formatted)

    def test_flawed_router_exposes_fp_fn(self) -> None:
        report = evaluate_router(router_fn=flawed_router, dataset=ROUTING_EVAL_DATASET)
        self.assertGreater(len(report["browser_false_positives"]), 0)
        self.assertGreater(len(report["browser_false_negatives"]), 0)
        self.assertGreater(len(report["approval_false_negatives"]), 0)

    def test_threshold_recommendations_exist(self) -> None:
        report = evaluate_router(router_fn=flawed_router, dataset=ROUTING_EVAL_DATASET)
        rec = report["threshold_recommendations"]
        self.assertIn("general", rec)
        self.assertIn("research", rec)
        self.assertIn("task", rec)


if __name__ == "__main__":
    unittest.main()
