import { describe, expect, it } from "vitest";

import {
  AUTH_ROUTE,
  DEFAULT_SIGNED_IN_ROUTE,
  authSignInUrl,
  isAuthPath,
  resolveSignedInDestination,
  sanitizeAuthRedirect,
} from "@/lib/auth/redirects";

describe("sanitizeAuthRedirect", () => {
  it("accepts internal application paths", () => {
    expect(sanitizeAuthRedirect("/today")).toBe("/today");
    expect(sanitizeAuthRedirect("/library/my-book/4")).toBe("/library/my-book/4");
    expect(sanitizeAuthRedirect("/stats")).toBe("/stats");
  });

  it("keeps the query string and the fragment", () => {
    expect(sanitizeAuthRedirect("/review?words=1,2")).toBe("/review?words=1,2");
    expect(sanitizeAuthRedirect("/library/x/2#p3")).toBe("/library/x/2#p3");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeAuthRedirect("https://evil.com")).toBeNull();
    expect(sanitizeAuthRedirect("http://evil.com/today")).toBeNull();
    expect(sanitizeAuthRedirect("HTTPS://EVIL.COM")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeAuthRedirect("//evil.com")).toBeNull();
    expect(sanitizeAuthRedirect("//evil.com/today")).toBeNull();
  });

  it("rejects backslash variants browsers treat as an authority", () => {
    expect(sanitizeAuthRedirect("/\\evil.com")).toBeNull();
    expect(sanitizeAuthRedirect("/\\/evil.com")).toBeNull();
    expect(sanitizeAuthRedirect("\\\\evil.com")).toBeNull();
  });

  it("rejects non-http schemes", () => {
    expect(sanitizeAuthRedirect("javascript:alert(1)")).toBeNull();
    expect(sanitizeAuthRedirect("data:text/html,<script>")).toBeNull();
    expect(sanitizeAuthRedirect("mailto:a@b.pl")).toBeNull();
  });

  it("rejects control characters used to smuggle a scheme past a trim", () => {
    expect(sanitizeAuthRedirect("\njavascript:alert(1)")).toBeNull();
    expect(sanitizeAuthRedirect("/ja\tvascript:alert(1)")).toBeNull();
    expect(sanitizeAuthRedirect("/today\r\nSet-Cookie: a=b")).toBeNull();
  });

  it("rejects anything that is not a root-relative path", () => {
    expect(sanitizeAuthRedirect("today")).toBeNull();
    expect(sanitizeAuthRedirect("../today")).toBeNull();
    expect(sanitizeAuthRedirect("")).toBeNull();
    expect(sanitizeAuthRedirect("   ")).toBeNull();
  });

  it("rejects non-strings and absurd lengths", () => {
    expect(sanitizeAuthRedirect(null)).toBeNull();
    expect(sanitizeAuthRedirect(undefined)).toBeNull();
    expect(sanitizeAuthRedirect(`/${"a".repeat(600)}`)).toBeNull();
  });

  it("refuses to send a learner back to the auth screen", () => {
    expect(sanitizeAuthRedirect("/auth")).toBeNull();
    expect(sanitizeAuthRedirect("/auth?mode=register")).toBeNull();
    expect(sanitizeAuthRedirect("/auth/forgot-password")).toBeNull();
  });

  it("does not treat a route that merely starts with the word as auth", () => {
    expect(sanitizeAuthRedirect("/authors")).toBe("/authors");
  });
});

describe("isAuthPath", () => {
  it("covers the auth route and its children only", () => {
    expect(isAuthPath("/auth")).toBe(true);
    expect(isAuthPath("/auth/callback")).toBe(true);
    expect(isAuthPath("/authors")).toBe(false);
    expect(isAuthPath("/today")).toBe(false);
  });
});

describe("authSignInUrl", () => {
  it("encodes a safe destination", () => {
    expect(authSignInUrl("/today")).toBe("/auth?next=%2Ftoday");
    expect(authSignInUrl("/review?words=1,2")).toBe(
      "/auth?next=%2Freview%3Fwords%3D1%2C2",
    );
  });

  it("drops an unsafe destination rather than passing it on", () => {
    expect(authSignInUrl("https://evil.com")).toBe(AUTH_ROUTE);
    expect(authSignInUrl("//evil.com")).toBe(AUTH_ROUTE);
    expect(authSignInUrl(null)).toBe(AUTH_ROUTE);
  });
});

describe("resolveSignedInDestination", () => {
  it("prefers a safe destination", () => {
    expect(resolveSignedInDestination("/notebook")).toBe("/notebook");
  });

  it("falls back to the app home for anything else", () => {
    expect(resolveSignedInDestination("https://evil.com")).toBe(
      DEFAULT_SIGNED_IN_ROUTE,
    );
    expect(resolveSignedInDestination(null)).toBe(DEFAULT_SIGNED_IN_ROUTE);
  });
});
