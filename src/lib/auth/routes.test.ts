import { describe, expect, it } from "vitest";

import { requiresAccount, routeAccess } from "@/lib/auth/routes";

describe("routeAccess", () => {
  it("treats the whole auth experience as public", () => {
    expect(routeAccess("/auth")).toBe("public");
    expect(routeAccess("/auth/callback")).toBe("public");
    expect(routeAccess("/auth/forgot-password")).toBe("public");
    expect(routeAccess("/auth/reset-password")).toBe("public");
  });

  it("keeps the shop window open", () => {
    expect(routeAccess("/")).toBe("public");
    expect(routeAccess("/browse")).toBe("public");
    expect(routeAccess("/library")).toBe("public");
    expect(routeAccess("/library/der-prozess")).toBe("public");
    expect(routeAccess("/learn")).toBe("public");
    expect(routeAccess("/words")).toBe("public");
  });

  it("requires an account for every private screen", () => {
    expect(routeAccess("/today")).toBe("account");
    expect(routeAccess("/review")).toBe("account");
    expect(routeAccess("/review/notebook")).toBe("account");
    expect(routeAccess("/stats")).toBe("account");
    expect(routeAccess("/settings")).toBe("account");
    expect(routeAccess("/notebook")).toBe("account");
    expect(routeAccess("/calibration")).toBe("account");
    expect(routeAccess("/practice/word_order")).toBe("account");
    expect(routeAccess("/learn/12")).toBe("account");
    expect(routeAccess("/learn/12/test")).toBe("account");
  });

  it("gates the reader, which is where the private writing happens", () => {
    expect(routeAccess("/library/der-prozess/3")).toBe("account");
    expect(routeAccess("/library/der-prozess/3/przygotowanie")).toBe("account");
    expect(routeAccess("/library/der-prozess/3/wyzwanie")).toBe("account");
  });

  it("does not mistake the importer for a book page", () => {
    expect(routeAccess("/library/import")).toBe("account");
    expect(routeAccess("/library/import/abc-123")).toBe("account");
  });

  it("marks the admin subtree as admin", () => {
    expect(routeAccess("/admin")).toBe("admin");
    expect(routeAccess("/admin/library")).toBe("admin");
    expect(routeAccess("/admin/texts/3/preview")).toBe("admin");
  });

  it("defaults an unknown path to account, never to public", () => {
    expect(routeAccess("/something-new")).toBe("account");
    expect(routeAccess("/a/b/c/d")).toBe("account");
  });

  it("ignores a trailing slash", () => {
    expect(routeAccess("/library/")).toBe("public");
    expect(routeAccess("/today/")).toBe("account");
    expect(routeAccess("/admin/")).toBe("admin");
  });
});

describe("requiresAccount", () => {
  it("is true for private and admin routes alike", () => {
    expect(requiresAccount("/today")).toBe(true);
    expect(requiresAccount("/admin")).toBe(true);
    expect(requiresAccount("/browse")).toBe(false);
    expect(requiresAccount("/auth")).toBe(false);
  });
});
