import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionAutomationStatus,
  assertTransitionAutomationStatus,
} from '../lib/server/automation/stateMachine.ts';

test('supports required action state transitions', () => {
  assert.equal(canTransitionAutomationStatus({ from: 'detected', to: 'suggested' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'suggested', to: 'pending_confirm' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'pending_confirm', to: 'attempted' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'attempted', to: 'completed' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'attempted', to: 'failed' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'failed', to: 'pending_confirm' }), true);
  assert.equal(canTransitionAutomationStatus({ from: 'snoozed', to: 'suggested' }), true);
});

test('rejects invalid transitions', () => {
  assert.equal(canTransitionAutomationStatus({ from: 'completed', to: 'attempted' }), false);
  assert.equal(canTransitionAutomationStatus({ from: 'dismissed', to: 'suggested' }), false);
  assert.equal(canTransitionAutomationStatus({ from: 'detected', to: 'completed' }), false);

  assert.throws(() => {
    assertTransitionAutomationStatus({ from: 'completed', to: 'attempted' });
  }, /Invalid automation action status transition/i);
});
