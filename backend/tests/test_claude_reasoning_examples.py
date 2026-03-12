import json
import unittest

from app.services.claude_reasoning_service import (
    ClaudeReasoningService,
    transform_gemini_evidence_to_claude_context,
)


class ExampleAnthropicTransport:
    """Deterministic transport for example-style tests."""

    def generate_json(self, *, api_key, model, system_prompt, context_payload, timeout_s):
        prompt = context_payload["user_prompt"].lower()

        if "conflicting" in prompt:
            return json.dumps(
                {
                    "final_answer": "Evidence points in different directions across sources.",
                    "summary": "Conflicting evidence requires reconciliation.",
                    "key_points": ["Source A indicates lower cost.", "Source B indicates higher cost."],
                    "risks_or_uncertainties": ["Conflict between provided snippets."],
                    "citations_or_evidence_used": ["E1", "E2"],
                    "requires_user_followup": True,
                }
            )

        if "subscription" in prompt:
            return json.dumps(
                {
                    "final_answer": "Subscription pricing appears to increase after trial period.",
                    "summary": "The supplied snippets indicate post-trial billing.",
                    "key_points": ["Trial period is limited.", "Renewal appears automatic."],
                    "risks_or_uncertainties": [],
                    "citations_or_evidence_used": ["E1", "E2"],
                    "requires_user_followup": False,
                }
            )

        if "executive summary" in prompt:
            return json.dumps(
                {
                    "final_answer": "Top providers differ on fees, reliability, and settlement speed.",
                    "summary": "Comparative synthesis across provided evidence.",
                    "key_points": ["Provider A cheapest.", "Provider B most reliable."],
                    "risks_or_uncertainties": ["Limited regional coverage details."],
                    "citations_or_evidence_used": ["E1", "E2", "E3"],
                    "requires_user_followup": False,
                }
            )

        if "invalid-json" in prompt:
            return "not json"

        return json.dumps(
            {
                "final_answer": "Synthesis completed from provided evidence only.",
                "summary": "Direct synthesis from router context.",
                "key_points": ["Point 1", "Point 2"],
                "risks_or_uncertainties": [],
                "citations_or_evidence_used": ["E1"],
                "requires_user_followup": False,
            }
        )


class ClaudeReasoningExamplesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ClaudeReasoningService(
            api_key="fake-key",
            transport=ExampleAnthropicTransport(),
        )

    def test_example_1_research_synthesis(self) -> None:
        result = self.service.synthesize(
            user_prompt="Write an executive summary comparing payment orchestration providers.",
            category="research",
            router_output={"needs_reasoning": True, "confidence": 0.62},
            evidence=["Provider A has lower fees.", "Provider B has better uptime.", "Provider C is faster."],
        )
        self.assertIn("final_answer", result)
        self.assertEqual(result["requires_user_followup"], False)

    def test_example_2_financial_safety_language(self) -> None:
        result = self.service.synthesize(
            user_prompt="Summarize risks before changing my subscription plan.",
            category="task",
            router_output={"needs_reasoning": True, "confidence": 0.65},
            evidence=["Plan auto-renews monthly.", "Cancellation requires 24h notice."],
        )
        self.assertIn("approval", result["final_answer"].lower())

    def test_example_3_conflicting_evidence(self) -> None:
        result = self.service.synthesize(
            user_prompt="Resolve conflicting ACH return-rate claims from these notes.",
            category="research",
            router_output={"needs_reasoning": True, "confidence": 0.55},
            evidence=["Source A says 0.8%.", "Source B says 1.7% with conflicting methodology."],
        )
        self.assertTrue(result["requires_user_followup"])
        self.assertTrue(len(result["risks_or_uncertainties"]) >= 1)

    def test_example_4_invalid_json_fallback(self) -> None:
        result = self.service.synthesize(
            user_prompt="invalid-json: summarize account fee evidence",
            category="research",
            router_output={"needs_reasoning": True, "confidence": 0.4},
            evidence=["Fee is $10 monthly.", "Waiver available above balance threshold."],
        )
        self.assertIn("fallback", result["summary"].lower())

    def test_example_5_router_not_escalated(self) -> None:
        result = self.service.synthesize(
            user_prompt="What is ACH?",
            category="general",
            router_output={"needs_reasoning": False, "confidence": 0.92, "intent": "answer_direct"},
            evidence=["ACH is an electronic funds network."],
        )
        self.assertIn("did not require premium reasoning", " ".join(result["risks_or_uncertainties"]).lower())


class ContextTransformTest(unittest.TestCase):
    def test_transform_helper(self) -> None:
        context = transform_gemini_evidence_to_claude_context(
            user_prompt="Compare wallet providers.",
            category="research",
            router_output={"intent": "multi_step_reasoning", "confidence": 0.6},
            evidence=["A is cheaper", "B has better uptime", "A is cheaper"],
        )
        self.assertEqual(len(context["evidence_items"]), 2)
        self.assertIn("router_context", context)


if __name__ == "__main__":
    unittest.main()
