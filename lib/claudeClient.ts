import 'server-only';

import Anthropic from "@anthropic-ai/sdk";
import { getRequiredSecret } from "@/security/secretsManager";

const anthropicApiKey = getRequiredSecret("ANTHROPIC_API_KEY");

export const anthropic = new Anthropic({
  apiKey: anthropicApiKey,
});
