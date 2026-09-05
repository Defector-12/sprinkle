import { describe, expect, it } from 'vitest';

import { OperationVersionTracker } from '../../src/application/operation-version.ts';

describe('OperationVersionTracker', () => {
  it('invalidates one key without affecting unrelated work', () => {
    const tracker = new OperationVersionTracker<string>();
    const first = tracker.snapshot('first');
    const second = tracker.snapshot('second');

    tracker.invalidate('first');

    expect(tracker.isCurrent('first', first)).toBe(false);
    expect(tracker.isCurrent('second', second)).toBe(true);
  });

  it('invalidates every version captured before a global clear', () => {
    const tracker = new OperationVersionTracker<string>();
    const checkpoint = tracker.checkpoint();
    const version = tracker.snapshot('page');

    tracker.invalidateAll();

    expect(tracker.isCurrent('page', version)).toBe(false);
    expect(tracker.isCheckpointCurrent('page', checkpoint)).toBe(false);
  });
});
