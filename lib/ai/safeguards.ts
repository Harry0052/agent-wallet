import type { ClassifiedRequestType } from '@/lib/ai/classifier';

export interface TinyFishActivationDecision {
  allow: boolean;
  warning?: string;
}

export function validateTinyFishActivation(requestType: ClassifiedRequestType): TinyFishActivationDecision {
  if (requestType !== 'task') {
    return {
      allow: false,
      warning: `TinyFish blocked: request type "${requestType}" is not allowed. TinyFish is only permitted for "task" requests.`,
    };
  }

  return { allow: true };
}
