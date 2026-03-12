# Agent Wallet Backend (FastAPI)

Production-minded FastAPI backend scaffold for a 3-layer agent router:
- Fast Router Layer: Gemini 2.5 Flash/Flash-Lite
- Premium Reasoning Layer: Claude Sonnet 4.6
- Browser Action Layer: AgentQL

## Folder Structure

```text
backend/
  .env.example
  requirements.txt
  README.md
  app/
    main.py
    api/
      routes.py
    core/
      config.py
    providers/
      gemini_provider.py
      claude_provider.py
      agentql_provider.py
    router/
      agent_wallet_router.py
    schemas/
      workflow.py
```

## Run Locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## API Endpoint

- `POST /execute`

### Example Request

```json
{
  "prompt": "Research the latest pricing differences between Model A and Model B",
  "category": "research",
  "approved": false
}
```

### Example Response

```json
{
  "intent": "grounded_research",
  "confidence": 0.84,
  "needs_reasoning": false,
  "needs_browser": false,
  "needs_approval": false,
  "answer": "Grounded research summary drafted by Gemini stub. TODO: replace with grounded answer and citations.",
  "evidence": [
    "Grounded result 1 (stub evidence)",
    "Grounded result 2 (stub evidence)"
  ],
  "missing_info": [],
  "reason": "Grounded research appears sufficient in fast layer."
}
```

## Notes

- `AgentWalletRouter.execute_workflow(prompt: str, category: str) -> dict` is the main orchestration method.
- Provider files include TODO markers where you should wire real SDK calls and keys.
- Browser actions requiring financial/account changes are approval-gated before execution.
