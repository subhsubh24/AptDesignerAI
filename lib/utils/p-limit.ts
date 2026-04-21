/**
 * Lightweight concurrency limiter. Same shape as the `p-limit` npm package,
 * but zero-dep so it works identically in edge and node runtimes.
 *
 * Usage:
 *   const limit = pLimit(5);
 *   const results = await Promise.all(items.map((i) => limit(() => work(i))));
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
