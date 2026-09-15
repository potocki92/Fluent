import { identityKey, type FluentUser } from "@/lib/auth/identity";
import { requiresAccount } from "@/lib/auth/routes";

/**
 * WHAT AN AUTH EVENT MEANS, decided in one pure function.
 *
 * `onAuthStateChange` fires for several quite different things — a sign-in, a
 * sign-out in this tab, a sign-out in another tab, a routine hourly token
 * rotation, a profile update — and the old code treated the ones it handled as
 * "set some local state". Two of those events mean "throw away everything this
 * browser remembers about a learner" and the rest emphatically do not, so the
 * distinction is the whole safety property and belongs somewhere it can be
 * tested rather than inside a `useEffect`.
 *
 * It takes the previous identity, the new one, and where the learner is
 * standing. It returns what must happen. It touches nothing.
 */
export interface AuthTransition {
  /**
   * Abandon the QueryClient and reset the user-scoped stores. True whenever the
   * identity is not the one the browser was holding — including a sign-out and
   * including A → B.
   */
  resetIdentityScopedState: boolean;
  /**
   * Re-render the server tree. The App Router caches RSC payloads per route, and
   * those payloads were rendered for the previous learner.
   */
  refreshServerState: boolean;
  /**
   * Leave for the sign-in screen. Only when there is no longer an account AND
   * the current route needs one — signing out while reading the public shelf is
   * not a reason to eject somebody from the shelf.
   */
  leaveForSignIn: boolean;
}

const NO_CHANGE: AuthTransition = {
  resetIdentityScopedState: false,
  refreshServerState: false,
  leaveForSignIn: false,
};

export function planAuthTransition({
  previousIdentity,
  nextUser,
  pathname,
}: {
  /** The identity key the browser last reconciled — `""` for signed out. */
  previousIdentity: string;
  /** Whoever the auth event reports, or `null`. */
  nextUser: FluentUser | null;
  /** The route the learner is currently on. */
  pathname: string;
}): AuthTransition {
  const nextIdentity = identityKey(nextUser);

  // The same person. A rotated token is a NEW TOKEN, not a new learner: tearing
  // the app down every hour would be a bug of its own (§17).
  if (nextIdentity === previousIdentity) return NO_CHANGE;

  return {
    resetIdentityScopedState: true,
    refreshServerState: true,
    leaveForSignIn: !nextUser && requiresAccount(pathname),
  };
}
