import type { Json } from "@/types/database";

/**
 * Hand a plain object to an RPC parameter typed as {@link Json}.
 *
 * WHY A CAST IS NEEDED AT ALL. Every value in these payloads is a string,
 * number, boolean, null, array or plain object — they are JSON by construction.
 * TypeScript cannot see that through an `interface`, because an interface has
 * no implicit index signature and so is not assignable to
 * `{ [key: string]: Json }`. The value is fine; the proof is missing.
 *
 * WHY IT LIVES HERE. It was `as unknown as Json` in fourteen places. Fourteen
 * double casts is fourteen opportunities for one of them to be hiding something
 * other than this — a `Date`, a `Map`, an `undefined` that `JSON.stringify`
 * drops silently — and no way to tell which by reading. One helper, named after
 * what it means, makes the safe case unremarkable and leaves any remaining
 * `as unknown as` in the codebase worth looking at.
 *
 * WHAT IT DOES NOT DO: validate. It is a statement about types, not a runtime
 * check. The constraint below rules out the two mistakes that are silent —
 * passing `undefined` (which `JSON.stringify` drops without a word) and passing
 * a `symbol` — but it cannot rule out a `Date` or a `Map`, because TypeScript
 * has no way to say "an object, but not those". The RPC's own parameter and the
 * SQL function that reads it remain the real contract.
 */
export function toJson<T extends JsonLike>(value: T): Json {
  return value as unknown as Json;
}

/**
 * Structurally JSON, as far as the type system can usefully tell.
 *
 * `object` rather than an index signature on purpose: an `interface` has no
 * implicit index signature, so `{ [key: string]: unknown }` would reject
 * exactly the domain types this helper exists to pass — which is the constraint
 * being stricter than the truth rather than closer to it.
 */
type JsonLike = string | number | boolean | null | object;
