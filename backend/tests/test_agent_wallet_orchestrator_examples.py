import json
import unittest
from typing import Any

from app.services.agent_wallet_orchestrator import AgentWalletOrchestrator
from app.services.agentql_execution_service import AgentQLExecutionService
from app.services.approval_gate_service import ApprovalGateEngine
from app.services.claude_reasoning_service import ClaudeReasoningService
from app.services.gemini_routing_service import GeminiRoutingService


class FakeGeminiTransport:
    def generate_json(self, *, api_key: str, model: str, payload: dict[str, Any], timeout_s: int) -> str:
        user_text = payload["contents"][0]["parts"][0]["text"].lower()
        prompt = user_text.split("prompt:", 1)[-1].strip()

        if "direct_general" in prompt:
            return json.dumps(
                {
                    "intent": "answer_direct",
                    "confidence": 0.92,
                    "needs_reasoning": False,
                    "needs_browser": False,
                    "needs_approval": False,
                    "answer": "Direct fast-layer answer.",
                    "evidence": [],
                    "missing_info": [],
                    "reason": "Simple request.",
                }
            )

        if "grounded_research" in prompt:
            return json.dumps(
                {
                    "intent": "grounded_research",
                    "confidence": 0.86,
                    "needs_reasoning": False,
                    "needs_browser": False,
                    "needs_approval": False,
                    "answer": "Grounded summary from fast layer.",
                    "evidence": ["Snippet A", "Snippet B"],
                    "missing_info": [],
                    "reason": "Grounded research sufficient.",
                }
            )

        if "needs_reasoning" in prompt:
            return json.dumps(
                {
                    "intent": "grounded_research",
                    "confidence": 0.55,
                    "needs_reasoning": True,
                    "needs_browser": False,
                    "needs_approval": False,
                    "answer": "",
                    "evidence": ["Complex evidence 1", "Complex evidence 2"],
                    "missing_info": ["Cross-source synthesis"],
                    "reason": "Complex synthesis required.",
                }
            )

        if "low_confidence" in prompt:
            return json.dumps(
                {
                    "intent": "answer_direct",
                    "confidence": 0.42,
                    "needs_reasoning": False,
                    "needs_browser": False,
                    "needs_approval": False,
                    "answer": "Potentially weak answer.",
                    "evidence": ["Thin snippet"],
                    "missing_info": [],
                    "reason": "Low confidence route.",
                }
            )

        if "browser_no_approval" in prompt:
            return json.dumps(
                {
                    "intent": "browser_action",
                    "confidence": 0.83,
                    "needs_reasoning": False,
                    "needs_browser": True,
                    "needs_approval": False,
                    "answer": "",
                    "evidence": [],
                    "missing_info": [],
                    "reason": "Browser flow needed.",
                }
            )

        if "browser_approval_required" in prompt:
            return json.dumps(
                {
                    "intent": "browser_action",
                    "confidence": 0.88,
                    "needs_reasoning": False,
                    "needs_browser": True,
                    "needs_approval": True,
                    "answer": "",
                    "evidence": [],
                    "missing_info": [],
                    "reason": "Browser flow with financial side effect.",
                }
            )

        # Default route for catch-all.
        return json.dumps(
            {
                "intent": "answer_direct",
                "confidence": 0.9,
                "needs_reasoning": False,
                "needs_browser": False,
                "needs_approval": False,
                "answer": "Default direct answer.",
                "evidence": [],
                "missing_info": [],
                "reason": "Default.",
            }
        )


class FakeClaudeTransport:
    def generate_json(self, *, api_key, model, system_prompt, context_payload, timeout_s):
        return json.dumps(
            {
                "final_answer": "Synthesized premium answer.",
                "summary": "High-quality reasoning output.",
                "key_points": ["Point A", "Point B"],
                "risks_or_uncertainties": [],
                "citations_or_evidence_used": ["E1", "E2"],
                "requires_user_followup": False,
            }
        )


class FakeAgentQLTransport:
    def __init__(self) -> None:
        self.sessions = {}

    def start_session(self, *, base_url: str) -> str:
        session_id = f"s{len(self.sessions) + 1}"
        self.sessions[session_id] = base_url
        return session_id

    def navigate(self, *, session_id: str, url: str) -> None:
        self.sessions[session_id] = url

    def click(self, *, session_id: str, selector: str) -> None:
        if not selector:
            raise RuntimeError("selector missing")

    def type(self, *, session_id: str, selector: str, text: str) -> None:
        if not selector:
            raise RuntimeError("selector missing")

    def extract(self, *, session_id: str, fields: list[str]) -> dict[str, Any]:
        return {field: f"extracted_{field}" for field in fields}

    def get_current_url(self, *, session_id: str) -> str:
        return self.sessions[session_id]

    def close_session(self, *, session_id: str) -> None:
        self.sessions.pop(session_id, None)


class AgentWalletOrchestratorExamplesTest(unittest.TestCase):
    def setUp(self) -> None:
        gemini = GeminiRoutingService(api_key="fake-key", transport=FakeGeminiTransport())
        claude = ClaudeReasoningService(api_key="fake-key", transport=FakeClaudeTransport())
        browser = AgentQLExecutionService(transport=FakeAgentQLTransport())
        approval = ApprovalGateEngine()
        self.orchestrator = AgentWalletOrchestrator(
            gemini_router=gemini,
            claude_reasoner=claude,
            browser_executor=browser,
            approval_gate=approval,
        )

    def test_example_1_general_direct(self) -> None:
        out = self.orchestrator.execute(prompt="direct_general: what is ACH?", category="general")
        self.assertEqual(out["route_taken"], "gemini_direct")
        self.assertTrue(out["success"])

    def test_example_2_research_grounded(self) -> None:
        out = self.orchestrator.execute(
            prompt="grounded_research: latest card network uptime summary",
            category="research",
        )
        self.assertEqual(out["route_taken"], "gemini_research")
        self.assertTrue(out["success"])

    def test_example_3_research_reasoning(self) -> None:
        out = self.orchestrator.execute(
            prompt="needs_reasoning: compare multi-country payment rails",
            category="research",
        )
        self.assertEqual(out["route_taken"], "claude_reasoning")
        self.assertIn("final_answer", out["reasoning_output"])

    def test_example_4_general_low_confidence_reasoning(self) -> None:
        out = self.orchestrator.execute(
            prompt="low_confidence: explain legal settlement implications",
            category="general",
        )
        self.assertEqual(out["route_taken"], "claude_reasoning")
        self.assertTrue(out["success"])

    def test_example_5_task_browser_no_approval(self) -> None:
        out = self.orchestrator.execute(
            prompt="browser_no_approval: login and extract dashboard metrics",
            category="task",
            browser_execution_request={
                "site": "https://app.example.com",
                "steps": [
                    {"action": "login"},
                    {"action": "navigate", "target": "https://app.example.com/dashboard"},
                    {"action": "extract", "target": "metrics"},
                ],
                "data_to_extract": ["mrr", "active_users"],
                "stop_before_commit": True,
            },
        )
        self.assertEqual(out["route_taken"], "agentql_execution")
        self.assertTrue(out["success"])

    def test_example_6_task_browser_approval_required_pause(self) -> None:
        out = self.orchestrator.execute(
            prompt="browser_approval_required: buy plan and checkout",
            category="task",
            approval_granted=False,
            browser_execution_request={
                "site": "https://shop.example.com",
                "steps": [
                    {"action": "navigate", "target": "https://shop.example.com/product/1"},
                    {"action": "click", "target": "#add-to-cart"},
                    {"action": "click", "target": "#checkout", "irreversible": True},
                ],
                "needs_approval": True,
                "stop_before_commit": True,
            },
        )
        self.assertEqual(out["route_taken"], "approval_required")
        self.assertTrue(out["execution_output"]["approval_decision"]["needs_approval"])

    def test_example_7_task_browser_approval_granted_executes(self) -> None:
        out = self.orchestrator.execute(
            prompt="browser_approval_required: buy plan and checkout",
            category="task",
            approval_granted=True,
            browser_execution_request={
                "site": "https://shop.example.com",
                "steps": [
                    {"action": "navigate", "target": "https://shop.example.com/product/1"},
                    {"action": "click", "target": "#add-to-cart"},
                    {"action": "click", "target": "#checkout", "irreversible": True},
                ],
                "needs_approval": True,
                "stop_before_commit": True,
            },
        )
        self.assertEqual(out["route_taken"], "agentql_execution")
        self.assertIn(
            out["execution_output"]["execution_result"]["status"],
            {"completed", "paused_for_approval"},
        )

    def test_example_8_task_browser_commit_guard(self) -> None:
        out = self.orchestrator.execute(
            prompt="browser_no_approval: cancel subscription confirm",
            category="task",
            approval_granted=False,
            browser_execution_request={
                "site": "https://billing.example.com",
                "steps": [
                    {"action": "login"},
                    {"action": "navigate", "target": "https://billing.example.com/settings"},
                    {"action": "click", "target": "#confirm-cancel", "irreversible": True},
                ],
                "stop_before_commit": True,
            },
        )
        self.assertEqual(out["route_taken"], "approval_required")


if __name__ == "__main__":
    unittest.main()
