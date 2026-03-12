import unittest

from app.services.gemini_routing_service import GeminiRoutingService


class InvalidJSONTransport:
    def generate_json(self, *, api_key, model, payload, timeout_s):
        return "not-valid-json"


class MissingConfidenceTransport:
    def generate_json(self, *, api_key, model, payload, timeout_s):
        return (
            '{"intent":"grounded_research","needs_reasoning":false,'
            '"needs_browser":false,"needs_approval":false,"answer":"ok",'
            '"evidence":[],"missing_info":[],"reason":"Research: valid but confidence missing"}'
        )


class GeminiRoutingExamplesTest(unittest.TestCase):
    """Unit-test-like routing examples with deterministic fallback behavior."""

    def setUp(self) -> None:
        # Empty API key forces local fallback so tests are deterministic.
        self.service = GeminiRoutingService(api_key="")

    def test_routing_examples(self) -> None:
        examples = [
            {
                "prompt": "What is the difference between debit and credit cards?",
                "category": "general",
                "expected": {
                    "intent": "answer_direct",
                    "needs_browser": False,
                    "needs_reasoning": False,
                    "needs_approval": False,
                },
            },
            {
                "prompt": "Research current ACH settlement windows in the US.",
                "category": "research",
                "expected": {
                    "intent": "grounded_research",
                    "needs_browser": False,
                    "needs_reasoning": False,
                    "needs_approval": False,
                },
            },
            {
                "prompt": (
                    "Research a multi-country legal and regulatory comparison of open banking "
                    "across countries with cross-source synthesis."
                ),
                "category": "research",
                "expected": {
                    "intent": "multi_step_reasoning",
                    "needs_browser": False,
                    "needs_reasoning": True,
                    "needs_approval": False,
                },
            },
            {
                "prompt": "Log in to my bank portal and click statements to extract latest entries.",
                "category": "task",
                "expected": {
                    "intent": "browser_action",
                    "needs_browser": True,
                    "needs_reasoning": False,
                    "needs_approval": False,
                },
            },
            {
                "prompt": "Open the website, add to cart, and checkout this plan.",
                "category": "task",
                "expected": {
                    "intent": "browser_action",
                    "needs_browser": True,
                    "needs_reasoning": False,
                    "needs_approval": True,
                },
            },
            {
                "prompt": "Navigate to settings and update email on my account.",
                "category": "task",
                "expected": {
                    "intent": "browser_action",
                    "needs_browser": True,
                    "needs_reasoning": False,
                    "needs_approval": True,
                },
            },
            {
                "prompt": "Transfer funds from checking to savings now.",
                "category": "general",
                "expected": {
                    "intent": "answer_direct",
                    "needs_browser": False,
                    "needs_reasoning": False,
                    "needs_approval": True,
                },
            },
            {
                "prompt": "Need a cross-border framework with tradeoff synthesis for remittance risk.",
                "category": "research",
                "expected": {
                    "intent": "multi_step_reasoning",
                    "needs_browser": False,
                    "needs_reasoning": True,
                    "needs_approval": False,
                },
            },
            {
                "prompt": "Build a cross-border compliance planning outline for wallet launch.",
                "category": "task",
                "expected": {
                    "intent": "multi_step_reasoning",
                    "needs_browser": False,
                    "needs_reasoning": True,
                    "needs_approval": False,
                },
            },
            {
                "prompt": "Navigate to the live site and fill out the KYC form fields.",
                "category": "task",
                "expected": {
                    "intent": "browser_action",
                    "needs_browser": True,
                    "needs_reasoning": False,
                    "needs_approval": False,
                },
            },
        ]

        for idx, case in enumerate(examples, start=1):
            with self.subTest(example=idx):
                result = self.service.route(prompt=case["prompt"], category=case["category"])
                self.assertGreaterEqual(result["confidence"], 0.0)
                self.assertLessEqual(result["confidence"], 1.0)
                for key, expected_value in case["expected"].items():
                    self.assertEqual(result[key], expected_value, msg=f"Mismatch for key={key}")


if __name__ == "__main__":
    unittest.main()


class GeminiRoutingResilienceTest(unittest.TestCase):
    def test_invalid_json_falls_back(self) -> None:
        service = GeminiRoutingService(
            api_key="fake-key",
            transport=InvalidJSONTransport(),
        )
        result = service.route(prompt="Research ACH return rates.", category="research")
        self.assertEqual(result["intent"], "grounded_research")
        self.assertIn("failed", result["reason"].lower())

    def test_missing_confidence_uses_safe_default(self) -> None:
        service = GeminiRoutingService(
            api_key="fake-key",
            transport=MissingConfidenceTransport(),
        )
        result = service.route(prompt="Research ACH return rates.", category="research")
        self.assertEqual(result["intent"], "grounded_research")
        self.assertEqual(result["confidence"], 0.35)
