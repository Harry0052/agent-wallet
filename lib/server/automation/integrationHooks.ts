import type { AutomationActionType } from '@/lib/types';
import type { AutomationActionRecord } from '@/lib/server/automation/types';

export interface AutomationHookAttemptResult {
  supported: boolean;
  status: 'completed' | 'failed';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationIntegrationHook {
  key: string;
  supports(actionType: AutomationActionType): boolean;
  attempt(input: {
    action: AutomationActionRecord;
  }): Promise<AutomationHookAttemptResult>;
}

class UnsupportedAutomationHook implements AutomationIntegrationHook {
  key = 'unsupported-provider';

  supports(): boolean {
    return true;
  }

  async attempt(): Promise<AutomationHookAttemptResult> {
    return {
      supported: false,
      status: 'failed',
      message: 'No provider integration is configured for this automation action yet.',
    };
  }
}

const hooks: AutomationIntegrationHook[] = [];
const unsupported = new UnsupportedAutomationHook();

export function registerAutomationIntegrationHook(hook: AutomationIntegrationHook): void {
  hooks.push(hook);
}

export function getAutomationIntegrationHook(actionType: AutomationActionType): AutomationIntegrationHook {
  for (const hook of hooks) {
    if (hook.supports(actionType)) return hook;
  }
  return unsupported;
}
