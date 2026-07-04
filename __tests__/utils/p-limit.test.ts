import { describe, it, expect } from "vitest";
import { pLimit } from "@/lib/utils/p-limit";

/**
 * Concurrency limiter used across the product-search / multi-room fan-outs.
 * Zero prior coverage. Pins: the cap is never exceeded, queued tasks drain as
 * slots free, results resolve to each task's value, a rejection still frees its
 * slot (the pool doesn't wedge), and ordering of returned promises is stable.
 */

/** Drain the microtask queue so the limiter finishes scheduling. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A deferred that lets a test hold a task "in flight" until it chooses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pLimit", () => {
  it("resolves each task to its own value, preserving array order", async () => {
    const limit = pLimit(2);
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => limit(async () => n * 10)),
    );
    expect(results).toEqual([10, 20, 30, 40]);
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    const limit = pLimit(2);
    let active = 0;
    let maxActive = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const runs = gates.map((g) =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await g.promise;
        active--;
      }),
    );

    // Let the limiter schedule the first batch.
    await flush();
    expect(active).toBe(2); // only 2 admitted, tasks 3 & 4 are queued

    // Release tasks one at a time; a freed slot admits the next queued task.
    gates[0].resolve();
    await flush();
    expect(active).toBe(2); // task 3 took the freed slot

    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await Promise.all(runs);
    expect(maxActive).toBe(2);
  });

  it("runs everything in parallel when concurrency >= task count", async () => {
    const limit = pLimit(5);
    let active = 0;
    let maxActive = 0;
    const gate = deferred<void>();

    const runs = [0, 1, 2].map(() =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active--;
      }),
    );
    await flush();
    expect(active).toBe(3);
    gate.resolve();
    await Promise.all(runs);
    expect(maxActive).toBe(3);
  });

  it("propagates rejection to the caller AND frees the slot for queued tasks", async () => {
    const limit = pLimit(1);
    const boom = limit(async () => {
      throw new Error("boom");
    });
    // Queued behind the failing task; must still run once its slot frees.
    const after = limit(async () => "ran-after-failure");

    await expect(boom).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ran-after-failure");
  });

  it("processes a large queue with concurrency 1 in FIFO order", async () => {
    const limit = pLimit(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
