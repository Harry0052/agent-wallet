import unittest

from app.services.approval_gate_service import (
    APPROVAL_NOT_REQUIRED_PROMPTS,
    APPROVAL_REQUIRED_PROMPTS,
    ApprovalGateEngine,
    requires_approval,
)


class ApprovalGateServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = ApprovalGateEngine()

    def test_financial_purchase_requires_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Buy this item and checkout now.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#checkout", "irreversible": True}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "financial")
        self.assertFalse(decision["safe_to_continue_without_approval"])

    def test_transfer_top_up_requires_approval(self) -> None:
        decision = requires_approval(
            original_user_prompt="Transfer funds and top up my wallet by $25.",
            router_intent="task_execution",
            execution_plan={"steps": [{"action": "fill", "target": "#amount", "value": "25"}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "financial")

    def test_account_change_requires_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Go to account settings and change password.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#save-settings", "irreversible": True}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "account_change")

    def test_external_commitment_send_email_requires_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Draft and send email to all customers.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#send-email"}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "external_commitment")

    def test_external_commitment_delete_data_requires_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Delete data for inactive users.",
            router_intent="task",
            execution_plan={"steps": [{"action": "click", "target": "#delete-data", "irreversible": True}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertIn(decision["approval_type"], {"account_change", "external_commitment"})

    def test_booking_confirmation_requires_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Confirm booking for tomorrow's flight.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#confirm-booking"}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "external_commitment")

    def test_read_only_extraction_no_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Log in and extract invoices only.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "login"}, {"action": "extract", "target": "invoice_table"}]},
            category="task",
        )
        self.assertFalse(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "none")
        self.assertTrue(decision["safe_to_continue_without_approval"])

    def test_research_only_no_approval(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Research open banking market trends in Europe.",
            router_intent="grounded_research",
            execution_plan={"steps": []},
            category="research",
        )
        self.assertFalse(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "none")

    def test_irreversible_plan_requires_approval_even_without_keywords(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Proceed with the final action.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#confirm", "irreversible": True}]},
            category="task",
        )
        self.assertTrue(decision["needs_approval"])
        self.assertEqual(decision["approval_type"], "external_commitment")

    def test_build_approval_challenge_payload(self) -> None:
        decision = self.engine.evaluate(
            original_user_prompt="Buy annual plan.",
            router_intent="browser_action",
            execution_plan={"steps": [{"action": "click", "target": "#checkout"}]},
            category="task",
        )
        challenge = self.engine.build_approval_challenge(
            decision=decision,
            workflow_id="wf_123",
            actor_id="user_abc",
        )
        self.assertTrue(challenge["required"])
        self.assertEqual(challenge["workflow_id"], "wf_123")
        self.assertIn("token_scope", challenge)

    def test_examples_lists_present(self) -> None:
        self.assertGreaterEqual(len(APPROVAL_REQUIRED_PROMPTS), 5)
        self.assertGreaterEqual(len(APPROVAL_NOT_REQUIRED_PROMPTS), 3)


if __name__ == "__main__":
    unittest.main()
