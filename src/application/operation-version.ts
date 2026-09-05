export interface OperationVersion {
  all: number;
  key: number;
}

export interface OperationCheckpoint<Key> {
  all: number;
  keys: ReadonlyMap<Key, number>;
}

export class OperationVersionTracker<Key> {
  private all = 0;
  private readonly keys = new Map<Key, number>();

  snapshot(key: Key): OperationVersion {
    return {
      all: this.all,
      key: this.keys.get(key) ?? 0,
    };
  }

  checkpoint(): OperationCheckpoint<Key> {
    return {
      all: this.all,
      keys: new Map(this.keys),
    };
  }

  invalidate(key: Key): void {
    this.keys.set(key, (this.keys.get(key) ?? 0) + 1);
  }

  invalidateAll(): void {
    this.all += 1;
    this.keys.clear();
  }

  isCurrent(key: Key, version: OperationVersion): boolean {
    const current = this.snapshot(key);
    return current.all === version.all && current.key === version.key;
  }

  isCheckpointCurrent(
    key: Key,
    checkpoint: OperationCheckpoint<Key>,
  ): boolean {
    return this.isCurrent(key, {
      all: checkpoint.all,
      key: checkpoint.keys.get(key) ?? 0,
    });
  }
}
