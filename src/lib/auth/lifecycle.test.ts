import { describe, expect, it } from "vitest";

import { toFluentUser } from "@/lib/auth/identity";
import { planAuthTransition } from "@/lib/auth/lifecycle";

const A = toFluentUser({ sub: "user-a", email: "a@przyklad.pl" })!;
const B = toFluentUser({ sub: "user-b", email: "b@przyklad.pl" })!;

describe("planAuthTransition", () => {
  it("does nothing when the same learner's token is refreshed", () => {
    // `TOKEN_REFRESHED` arrives roughly hourly with a brand-new JWT for the same
    // person. Resetting the app here would empty the cache mid-review (§17).
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: A,
        pathname: "/review",
      }),
    ).toEqual({
      resetIdentityScopedState: false,
      refreshServerState: false,
      leaveForSignIn: false,
    });
  });

  it("does nothing on a repeated signed-out event", () => {
    expect(
      planAuthTransition({
        previousIdentity: "",
        nextUser: null,
        pathname: "/auth",
      }).resetIdentityScopedState,
    ).toBe(false);
  });

  it("tears everything down and leaves when signing out of a private page", () => {
    // §98: this is the regression that mattered.
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: null,
        pathname: "/today",
      }),
    ).toEqual({
      resetIdentityScopedState: true,
      refreshServerState: true,
      leaveForSignIn: true,
    });
  });

  it("still tears everything down when signing out of a public page", () => {
    // The cache and the stores go either way; only the navigation is conditional
    // — being thrown off the public shelf for signing out would be absurd.
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: null,
        pathname: "/browse",
      }),
    ).toEqual({
      resetIdentityScopedState: true,
      refreshServerState: true,
      leaveForSignIn: false,
    });
  });

  it("isolates an account switch without redirecting", () => {
    // §99: A's cache must not survive into B's session, but B has just arrived
    // and belongs exactly where the sign-in sent them.
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: B,
        pathname: "/today",
      }),
    ).toEqual({
      resetIdentityScopedState: true,
      refreshServerState: true,
      leaveForSignIn: false,
    });
  });

  it("starts a signed-in session from a clean cache", () => {
    // §94: whatever a signed-out visitor accumulated while browsing the shelf is
    // not the new learner's data either.
    expect(
      planAuthTransition({
        previousIdentity: "",
        nextUser: A,
        pathname: "/auth",
      }),
    ).toEqual({
      resetIdentityScopedState: true,
      refreshServerState: true,
      leaveForSignIn: false,
    });
  });

  it("treats a sign-out in another tab exactly like one in this tab", () => {
    // §18/§103: Supabase broadcasts `SIGNED_OUT` to every tab; the plan does not
    // depend on which tab started it.
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: null,
        pathname: "/notebook",
      }).leaveForSignIn,
    ).toBe(true);
  });

  it("ejects from an unknown private route, since unknown means private", () => {
    expect(
      planAuthTransition({
        previousIdentity: "user-a",
        nextUser: null,
        pathname: "/some-future-screen",
      }).leaveForSignIn,
    ).toBe(true);
  });
});
