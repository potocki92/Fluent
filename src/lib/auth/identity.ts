/**
 * WHO IS THE USER — the one shape the rest of the app reads.
 *
 * Supabase hands identity over in three different currencies: a `User` object
 * from `getUser()`, a `Session` from the browser SDK, and a set of verified JWT
 * claims from `getClaims()`. Letting each caller pick meant `user.email` in one
 * place, `session.user.user_metadata.name` in another, and — the bug that
 * mattered — `user != null` being read as "this is a Fluent account" in a third.
 *
 * Everything here is PURE. It classifies identity; it never establishes it.
 * Establishing identity is the server's job (`src/lib/auth/server.ts`), and the
 * browser's copy is for rendering only.
 */

/** The identity the UI is allowed to know about. Deliberately tiny. */
export interface FluentUser {
  id: string;
  email: string | null;
  /** From `user_metadata.name` — a display name, never a unique username. */
  displayName: string | null;
  /**
   * A Supabase *guest* session. Fluent never calls `signInAnonymously()`, so in
   * practice this is always false — but `user != null` must never be allowed to
   * mean "has an account", because the day anonymous sign-in is switched on,
   * every `if (user)` in the codebase silently starts admitting guests.
   */
  isAnonymous: boolean;
}

/** The claim/user shapes this module accepts, structurally. */
interface IdentityLike {
  sub?: unknown;
  id?: unknown;
  email?: unknown;
  is_anonymous?: unknown;
  user_metadata?: unknown;
}

/** Longest display name we will render. Long enough for any real name. */
const MAX_DISPLAY_NAME = 60;

/**
 * Build a {@link FluentUser} from verified JWT claims or from a Supabase `User`.
 *
 * Returns `null` for anything without a subject — no session, an empty claims
 * object, a malformed token — so callers get one falsy answer instead of three.
 */
export function toFluentUser(source: IdentityLike | null | undefined): FluentUser | null {
  if (!source) return null;

  const id = asString(source.sub) ?? asString(source.id);
  if (!id) return null;

  return {
    id,
    email: asString(source.email),
    displayName: displayNameFrom(source.user_metadata),
    isAnonymous: source.is_anonymous === true,
  };
}

/**
 * A real Fluent account, as opposed to a guest session or nobody.
 *
 * This is the predicate every private route and every account feature asks.
 * `user !== null` is NOT the same question and must not be substituted for it.
 */
export function isAccountUser(user: FluentUser | null | undefined): user is FluentUser {
  return !!user && !user.isAnonymous;
}

/**
 * The value the client compares to decide "did the identity change?".
 *
 * A token refresh for the same person produces the same key, so it must not
 * reset anything; a sign-out, a sign-in, or a switch from A to B produces a
 * different one, and everything user-scoped in memory is discarded.
 */
export function identityKey(user: FluentUser | null | undefined): string {
  return user?.id ?? "";
}

/** The letter in the account avatar. Never a database read. */
export function accountInitial(user: FluentUser | null | undefined): string {
  const source = user?.displayName?.trim() || user?.email?.trim() || "";
  return source.slice(0, 1).toUpperCase() || "U";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * `user_metadata` is learner-supplied: it is whatever was passed to `signUp`,
 * so it is untrusted text. It is only ever rendered as a text node (React
 * escapes it) and it is bounded here so a 10 KB "name" cannot wreck the header.
 */
function displayNameFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const name = (metadata as { name?: unknown }).name;
  const trimmed = asString(name);
  return trimmed ? trimmed.slice(0, MAX_DISPLAY_NAME) : null;
}
