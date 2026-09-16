import { describe, expect, it } from "vitest";

import {
  accountInitial,
  identityKey,
  isAccountUser,
  toFluentUser,
} from "@/lib/auth/identity";

const CLAIMS = {
  sub: "11111111-1111-1111-1111-111111111111",
  email: "mateusz@przyklad.pl",
  is_anonymous: false,
  user_metadata: { name: "Mateusz" },
};

describe("toFluentUser", () => {
  it("builds an identity from verified JWT claims", () => {
    expect(toFluentUser(CLAIMS)).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      email: "mateusz@przyklad.pl",
      displayName: "Mateusz",
      isAnonymous: false,
    });
  });

  it("accepts a Supabase user object, which keys the id as `id`", () => {
    const user = toFluentUser({
      id: "22222222-2222-2222-2222-222222222222",
      email: "anna@przyklad.pl",
      user_metadata: {},
    });
    expect(user?.id).toBe("22222222-2222-2222-2222-222222222222");
    expect(user?.displayName).toBeNull();
  });

  it("returns null when there is no subject", () => {
    expect(toFluentUser(null)).toBeNull();
    expect(toFluentUser(undefined)).toBeNull();
    expect(toFluentUser({})).toBeNull();
    expect(toFluentUser({ sub: "   " })).toBeNull();
    expect(toFluentUser({ sub: 42 })).toBeNull();
  });

  it("bounds a learner-supplied display name", () => {
    const user = toFluentUser({ ...CLAIMS, user_metadata: { name: "x".repeat(200) } });
    expect(user?.displayName).toHaveLength(60);
  });

  it("ignores a display name that is not a string", () => {
    expect(toFluentUser({ ...CLAIMS, user_metadata: { name: 7 } })?.displayName)
      .toBeNull();
    expect(toFluentUser({ ...CLAIMS, user_metadata: "nope" })?.displayName)
      .toBeNull();
  });

  it("carries the anonymous flag through", () => {
    expect(toFluentUser({ sub: "abc", is_anonymous: true })?.isAnonymous).toBe(true);
    expect(toFluentUser({ sub: "abc" })?.isAnonymous).toBe(false);
  });
});

describe("isAccountUser", () => {
  it("accepts a real account", () => {
    expect(isAccountUser(toFluentUser(CLAIMS))).toBe(true);
  });

  it("rejects a guest session and nobody", () => {
    expect(isAccountUser(toFluentUser({ sub: "abc", is_anonymous: true }))).toBe(
      false,
    );
    expect(isAccountUser(null)).toBe(false);
    expect(isAccountUser(undefined)).toBe(false);
  });
});

describe("identityKey", () => {
  it("is stable for the same person and empty for nobody", () => {
    expect(identityKey(toFluentUser(CLAIMS))).toBe(CLAIMS.sub);
    // A refreshed token is a different token with the same subject, so the key
    // is unchanged and the app must NOT reset (§17).
    expect(identityKey(toFluentUser({ ...CLAIMS }))).toBe(CLAIMS.sub);
    expect(identityKey(null)).toBe("");
  });

  it("changes when the account changes", () => {
    expect(identityKey(toFluentUser(CLAIMS))).not.toBe(
      identityKey(toFluentUser({ ...CLAIMS, sub: "other" })),
    );
  });
});

describe("accountInitial", () => {
  it("prefers the display name, then the email", () => {
    expect(accountInitial(toFluentUser(CLAIMS))).toBe("M");
    expect(
      accountInitial(toFluentUser({ ...CLAIMS, user_metadata: {} })),
    ).toBe("M");
    expect(
      accountInitial(
        toFluentUser({ sub: "abc", email: "zofia@przyklad.pl", user_metadata: {} }),
      ),
    ).toBe("Z");
  });

  it("falls back to a neutral letter", () => {
    expect(accountInitial(null)).toBe("U");
    expect(accountInitial(toFluentUser({ sub: "abc" }))).toBe("U");
  });
});
