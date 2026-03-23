import 'server-only';

import { registerAutomationIntegrationHook } from '@/lib/server/automation/integrationHooks';
import { tinyFishHook } from './tinyFishAdapter';

/**
 * Register all execution providers with the automation hook system.
 *
 * Call this once during server startup or at the top of relevant API routes.
 * Providers are queried in registration order — first match wins.
 *
 * To add a new provider:
 * 1. Create an adapter implementing AutomationIntegrationHook
 * 2. Register it here
 * 3. The automation service will route matching action types to it automatically
 */

let registered = false;

export function ensureProvidersRegistered(): void {
  if (registered) return;
  registered = true;

  // Tiny Fish: browser-based subscription management
  registerAutomationIntegrationHook(tinyFishHook);

  // Future providers:
  // registerAutomationIntegrationHook(plaidTransferHook);
  // registerAutomationIntegrationHook(stripePaymentHook);
}
