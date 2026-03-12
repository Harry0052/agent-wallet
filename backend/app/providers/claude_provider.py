from __future__ import annotations


class ClaudeProvider:
    """Stub integration for premium reasoning with Claude Sonnet.

    TODO: Replace with Anthropic SDK call using the configured model.
    """

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def synthesize_research(
        self,
        prompt: str,
        evidence: list[str],
        missing_info: list[str],
    ) -> tuple[str, float, str]:
        evidence_block = "; ".join(evidence) if evidence else "No evidence provided"
        missing_block = ", ".join(missing_info) if missing_info else "None"

        answer = (
            "Premium synthesis drafted by Claude stub. "
            "TODO: replace with real Claude reasoning output. "
            f"Input evidence: {evidence_block}. Missing info: {missing_block}."
        )
        confidence = 0.78
        reason = "Complexity/incompleteness required premium reasoning fallback."
        return answer, confidence, reason
