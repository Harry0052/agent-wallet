from functools import lru_cache

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.gemini_routing import GeminiRoutingInput, GeminiRoutingOutput
from app.services.gemini_routing_service import GeminiRoutingService

router = APIRouter(prefix="/gemini", tags=["gemini-routing"])


@lru_cache(maxsize=1)
def get_gemini_routing_service() -> GeminiRoutingService:
    settings = get_settings()
    return GeminiRoutingService(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
    )


@router.post("/route", response_model=GeminiRoutingOutput)
def route_with_gemini(payload: GeminiRoutingInput) -> GeminiRoutingOutput:
    service = get_gemini_routing_service()
    result = service.route(prompt=payload.prompt, category=payload.category.value)
    return GeminiRoutingOutput.model_validate(result)
