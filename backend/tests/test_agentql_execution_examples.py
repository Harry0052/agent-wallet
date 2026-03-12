import unittest

from app.schemas.agentql_execution import AgentQLExecutionRequest
from app.services.agentql_execution_service import AgentQLExecutionService


class FakeAgentQLTransport:
    def __init__(self) -> None:
        self.sessions = {}

    def start_session(self, *, base_url: str) -> str:
        session_id = f"fake-{len(self.sessions) + 1}"
        self.sessions[session_id] = base_url
        return session_id

    def navigate(self, *, session_id: str, url: str) -> None:
        self.sessions[session_id] = url

    def click(self, *, session_id: str, selector: str) -> None:
        if not selector:
            raise RuntimeError("Missing selector")

    def type(self, *, session_id: str, selector: str, text: str) -> None:
        if not selector:
            raise RuntimeError("Missing selector")

    def extract(self, *, session_id: str, fields: list[str]) -> dict:
        return {field: f"value_for_{field}" for field in fields}

    def get_current_url(self, *, session_id: str) -> str:
        return self.sessions[session_id]

    def close_session(self, *, session_id: str) -> None:
        self.sessions.pop(session_id, None)


class AgentQLExecutionExamplesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = AgentQLExecutionService(transport=FakeAgentQLTransport())

    def test_extract_invoices_after_login(self) -> None:
        request = AgentQLExecutionRequest(
            goal="Login and extract invoices from the billing dashboard",
            site="https://app.example.com",
            steps=[
                {"action": "login", "description": "Log in with account credentials"},
                {"action": "navigate", "target": "https://app.example.com/billing/invoices"},
                {"action": "extract", "description": "Extract invoice table rows"},
            ],
            data_to_extract=["invoice_id", "amount", "due_date", "status"],
            stop_before_commit=True,
        )
        dry_run = self.service.executor(request=request, dry_run=True)
        self.assertEqual(dry_run.status, "planned")

        executed = self.service.executor(request=request, dry_run=False, approval_granted=False)
        self.assertEqual(executed.status, "completed")
        self.assertIn("invoice_id", executed.extracted_data)

    def test_add_item_to_cart_and_pause_before_payment(self) -> None:
        request = AgentQLExecutionRequest(
            goal="Add item to cart and complete checkout flow",
            site="https://shop.example.com",
            steps=[
                {"action": "navigate", "target": "https://shop.example.com/product/123"},
                {"action": "click", "target": "#add-to-cart"},
                {"action": "click", "target": "#checkout", "irreversible": True},
            ],
            needs_approval=True,
            stop_before_commit=True,
        )
        executed = self.service.executor(request=request, dry_run=False, approval_granted=False)
        self.assertEqual(executed.status, "paused_for_approval")
        self.assertTrue(executed.approval_checkpoint_reached)

    def test_cancel_subscription_pause_before_final_submit(self) -> None:
        request = AgentQLExecutionRequest(
            goal="Cancel subscription in account settings",
            site="https://billing.example.com",
            steps=[
                {"action": "login", "description": "Log in"},
                {"action": "navigate", "target": "https://billing.example.com/settings/subscription"},
                {"action": "click", "target": "#cancel-subscription", "irreversible": True},
                {"action": "click", "target": "#confirm-cancel", "irreversible": True},
            ],
            needs_approval=True,
            stop_before_commit=True,
        )
        executed = self.service.executor(request=request, dry_run=False, approval_granted=False)
        self.assertEqual(executed.status, "paused_for_approval")
        self.assertTrue(executed.approval_checkpoint_reached)

    def test_simple_research_request_is_blocked(self) -> None:
        request = AgentQLExecutionRequest(
            goal="Research the latest fintech fraud trends",
            site="https://example.com",
            steps=[],
            stop_before_commit=True,
        )
        planned = self.service.planner(request=request)
        self.assertEqual(planned.status, "failed")
        self.assertIn("simple research", planned.error.lower())


if __name__ == "__main__":
    unittest.main()
