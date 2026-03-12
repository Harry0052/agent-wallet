from functools import lru_cache

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.providers.agentql_provider import AgentQLProvider
from app.providers.claude_provider import ClaudeProvider
from app.providers.gemini_provider import GeminiProvider
from app.router.agent_wallet_router import AgentWalletRouter
from app.schemas.workflow import ExecuteRequest, RouterResponse

router = APIRouter()


@lru_cache(maxsize=1)
def get_agent_wallet_router() -> AgentWalletRouter:
    settings: Settings = get_settings()
    return AgentWalletRouter(
        gemini_provider=GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        ),
        claude_provider=ClaudeProvider(
            api_key=settings.claude_api_key,
            model=settings.claude_model,
        ),
        agentql_provider=AgentQLProvider(
            api_key=settings.agentql_api_key,
            base_url=settings.agentql_base_url,
        ),
    )


@router.post("/execute", response_model=RouterResponse)
def execute(
    payload: ExecuteRequest,
    workflow_router: AgentWalletRouter = Depends(get_agent_wallet_router),
) -> RouterResponse:
    """Execute one workflow request through the layered router policy."""
    routed = workflow_router.execute_workflow(
        prompt=payload.prompt,
        category=payload.category.value,
    )
    result = RouterResponse(**routed)

    if result.intent == "browser_action":
        if result.needs_approval and not payload.approved:
            result.reason = (
                "Approval is required before executing financial or account-changing "
                "browser actions."
            )
            result.answer = ""
            return result

        executed = workflow_router.execute_browser_action(
            prompt=payload.prompt,
            approved=payload.approved,
        )
        return RouterResponse(**executed)

    return result
