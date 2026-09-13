/**
 * Idempotency tokens for learner interactions.
 *
 * One token is minted per card presentation and travels with the grading
 * request. It is what makes a double tap, a retried Server Action or a replayed
 * POST settle the SAME review rather than a second one — the database enforces
 * that with a unique constraint on (user_id, interaction_id), so the guarantee
 * does not depend on the UI remembering to debounce.
 *
 * The value only has to be unique, never unguessable: it is scoped to the
 * calling user's own rows and confers nothing.
 */
export function newInteractionId(): string {
  // Available in every browser this app supports; the fallback keeps a
  // non-secure context or an old WebView from losing the guarantee entirely.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Read a ref holding the token, minting one if it is still empty.
 *
 * The refs are seeded from an effect — render must stay pure — so a grade that
 * somehow arrived before that effect ran would otherwise send an empty token and
 * lose the idempotency guarantee. This makes the token exist by the time it is
 * used, whatever the ordering.
 */
export function ensureInteractionId(ref: { current: string }): string {
  if (!ref.current) ref.current = newInteractionId();
  return ref.current;
}
