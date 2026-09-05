import { describe, expect, it } from 'vitest';

import { SerialTaskQueue } from '../../src/application/serial-task-queue.ts';

describe('SerialTaskQueue', () => {
  it('runs mutations in invocation order', async () => {
    const queue = new SerialTaskQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = queue.run(async () => {
      order.push('first:start');
      markFirstStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
    });
    const second = queue.run(async () => {
      order.push('second');
    });

    await firstStarted;
    expect(order).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues after a failed mutation', async () => {
    const queue = new SerialTaskQueue();

    await expect(
      queue.run(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(queue.run(async () => 'next')).resolves.toBe('next');
  });
});
