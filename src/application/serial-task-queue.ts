export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.tail.catch(() => undefined).then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
