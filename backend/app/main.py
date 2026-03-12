from fastapi import FastAPI

from app.api.gemini_routes import router as gemini_router
from app.api.routes import router as workflow_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Agent Wallet backend router with fast, premium, and browser layers.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(workflow_router)
app.include_router(gemini_router)
