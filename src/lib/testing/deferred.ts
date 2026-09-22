/**
 * A promise whose settlement another piece of the test controls.
 *
 * Tests that assert on *concurrency* — a second tap while the first is in
 * flight, a late response landing after the session moved on — need to hold a
 * call open and release it on cue. The idiomatic shape for that, capturing
 * `resolve` out of a `new Promise` executor, does not survive `strict`:
 *
 * ```ts
 * let release: (() => void) | null = null;
 * const blocked = new Promise<void>((resolve) => { release = resolve; });
 * release?.(); // TS2349 — narrowed to `null`, so to `never` after `?.`
 * ```
 *
 * TypeScript cannot see that the executor runs synchronously, so it keeps the
 * `null` narrowing from the initialiser. The usual workarounds each cost
 * something real: `release!` re-introduces the very non-null assertion strict
 * mode exists to remove, and `?.` silently turns "the test forgot to release"
 * into a passing no-op.
 *
 * This helper hands back an already-assigned resolver instead, so the call site
 * is plainly callable and a missing release fails loudly rather than quietly.
 */
export interface Deferred<T = void> {
  /** The promise to await. */
  readonly promise: Promise<T>;
  /** Settle it. Callable, always — no narrowing, no assertion. */
  readonly resolve: (value: T) => void;
  /** Reject it, for the "the transport blew up mid-flight" cases. */
  readonly reject: (reason?: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  // The executor runs synchronously, so both are assigned before `deferred`
  // returns. That fact is what the declarations above assert, in the one place
  // where it is provable by reading four adjacent lines.
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
