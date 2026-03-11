import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/harry/agent wallet';

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('candidate sourcing task store enforces per-user query scoping', () => {
  const source = read('lib/server/sourcingTaskStore.ts');
  assert.match(source, /WHERE user_id = \$1[\s\S]*AND id = \$2[\s\S]*AND task_type = 'candidate_sourcing_task'/);
  assert.match(source, /WHERE user_id = \$1[\s\S]*AND task_type = 'candidate_sourcing_task'[\s\S]*ORDER BY updated_at DESC/);
  assert.match(source, /UPDATE agent_tasks[\s\S]*WHERE user_id = \$1[\s\S]*AND id = \$2[\s\S]*AND task_type = 'candidate_sourcing_task'/);
  assert.match(source, /FROM web_action_logs[\s\S]*WHERE user_id = \$1[\s\S]*AND task_id = \$2/);
});

test('sourcing task detail route binds URL task lookup to authenticated user context', () => {
  const source = read('app/api/sourcing/tasks/[taskId]/route.ts');
  assert.match(source, /const userId = await getWalletUserId\(\)/);
  assert.match(source, /getCandidateSourcingTaskById\(\{[\s\S]*userId,[\s\S]*taskId: params\.taskId/);
  assert.match(source, /listCandidateSourcingLogs\(\{[\s\S]*userId,[\s\S]*taskId: task\.id/);
});

test('sourcing task list/action route only operates in authenticated user scope', () => {
  const source = read('app/api/sourcing/tasks/route.ts');
  assert.match(source, /const userId = await getWalletUserId\(\)/);
  assert.match(source, /listCandidateSourcingTasks\(\{[\s\S]*userId/);
  assert.match(source, /startCandidateSourcingTask\(\{[\s\S]*userId,[\s\S]*taskId: body\.taskId/);
});

test('agent task persistence fails closed without user identity', () => {
  const source = read('lib/server/ledger.ts');
  assert.doesNotMatch(source, /normalizeRequiredText\(params\.userId,\s*'default-user'\)/);
  assert.match(source, /recordAgentTask requires a non-empty userId/);
  assert.match(source, /supersedePendingAgentTask requires a non-empty userId/);
});

test('signup activation verification does not use a global shared user id', () => {
  const source = read('services/agent.ts');
  assert.doesNotMatch(source, /userId:\s*'wallet_user'/);
  assert.match(source, /runSignupActivationVerification\(params: \{[\s\S]*userId: string;/);
  assert.match(source, /engine\.verify\(\{[\s\S]*userId: params\.userId/);
});
