import { describe, expect, it } from "vitest";

import { activeRoute, isRouteActive, type NavRoute } from "@/lib/navigation";

const TODAY: NavRoute = { href: "/today" };
const READ: NavRoute = { href: "/library", also: ["/learn"] };
const REVIEW: NavRoute = { href: "/review" };

describe("isRouteActive", () => {
  it("matches the route itself", () => {
    expect(isRouteActive("/today", TODAY)).toBe(true);
  });

  it("matches everything under the route", () => {
    expect(isRouteActive("/library/der-prozess", READ)).toBe(true);
    expect(isRouteActive("/library/der-prozess/4", READ)).toBe(true);
    expect(isRouteActive("/review/notebook", REVIEW)).toBe(true);
  });

  it("matches the secondary roots a tab owns", () => {
    expect(isRouteActive("/learn", READ)).toBe(true);
    expect(isRouteActive("/learn/12/test", READ)).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isRouteActive("/libraries", READ)).toBe(false);
    expect(isRouteActive("/reviewer", REVIEW)).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isRouteActive("/library/", READ)).toBe(true);
  });

  it("does not light a tab up for an unrelated screen", () => {
    expect(isRouteActive("/settings", READ)).toBe(false);
    expect(isRouteActive("/today", READ)).toBe(false);
  });
});

describe("activeRoute", () => {
  const NAV = [TODAY, READ, REVIEW];

  it("returns the owning route", () => {
    expect(activeRoute("/learn/3", NAV)).toBe(READ);
  });

  it("returns null when nothing owns the path", () => {
    expect(activeRoute("/settings", NAV)).toBeNull();
  });
});
