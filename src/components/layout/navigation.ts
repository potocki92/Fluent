import {
  BarChart3,
  BookOpen,
  Ellipsis,
  Layers,
  Library,
  NotebookPen,
  Settings,
  Shield,
  Sun,
  type LucideIcon,
} from "lucide-react";

import { requiresAccount } from "@/lib/auth/routes";
import type { NavRoute } from "@/lib/navigation";

/**
 * THE LINK LIST, DECLARED ONCE.
 *
 * The desktop bar, the phone's tab bar, the „Więcej" screen, the account menu
 * and the Today quick actions all read from here. Before this file they each
 * carried their own array, which is how the header ended up offering five icons
 * nobody could name while the tab bar offered four different ones.
 *
 * The data lives next to the chrome that renders it rather than in `src/lib/`
 * because it carries icons and Polish copy — UI, not domain logic. The one part
 * that IS logic, "does this path light this tab up", is pure and lives in
 * `src/lib/navigation.ts`.
 *
 * `access` is not restated here either: `requiresAccount` already answers it
 * from the one route table, so a screen cannot be private in the proxy and
 * public in the menu.
 */
export interface NavItem extends NavRoute {
  label: string;
  /** One short helper line — the „Więcej" list and the quick actions show it. */
  description: string;
  icon: LucideIcon;
}

export const TODAY: NavItem = {
  href: "/today",
  label: "Dzisiaj",
  description: "Twój plan na dziś",
  icon: Sun,
};

/**
 * „Czytaj" is the LIBRARY. `/learn` still exists — the graded passages and their
 * comprehension tests — but reading has one home in the navigation, so the two
 * route trees share a tab.
 */
export const READ: NavItem = {
  href: "/library",
  label: "Czytaj",
  description: "Nowe teksty",
  icon: BookOpen,
  also: ["/learn"],
};

export const REVIEW: NavItem = {
  href: "/review",
  label: "Powtórki",
  description: "Utrwal wiedzę",
  icon: Layers,
};

export const PROGRESS: NavItem = {
  href: "/stats",
  label: "Postęp",
  description: "Twoje statystyki",
  icon: BarChart3,
};

export const DICTIONARY: NavItem = {
  href: "/browse",
  label: "Słownik",
  description: "Szukaj słów i znaczeń",
  icon: Library,
};

export const NOTEBOOK: NavItem = {
  href: "/notebook",
  label: "Mój zeszyt",
  description: "Twoje notatki i słowa",
  icon: NotebookPen,
};

export const SETTINGS: NavItem = {
  href: "/settings",
  label: "Ustawienia",
  description: "Dostosuj aplikację",
  icon: Settings,
};

export const ADMIN: NavItem = {
  href: "/admin",
  label: "Panel administratora",
  description: "Zarządzanie treścią",
  icon: Shield,
};

/** The phone's fourth tab. Not a destination in the product sense — a drawer. */
export const MORE: NavItem = {
  href: "/more",
  label: "Więcej",
  description: "Wszystko, czego potrzebujesz w jednym miejscu",
  icon: Ellipsis,
};

/** The four sections of the app, in the desktop top bar. */
export const PRIMARY_NAV: readonly NavItem[] = [TODAY, READ, REVIEW, PROGRESS];

/**
 * The four tabs on a phone.
 *
 * „Postęp" gives up its seat to „Więcej" deliberately: five labelled tabs do not
 * fit a 360px screen, and everything that used to be an unlabelled icon in the
 * header — the dictionary, the notebook, the settings, the admin panel — has to
 * live somewhere a thumb can reach.
 */
export const MOBILE_NAV: readonly NavItem[] = [TODAY, READ, REVIEW, MORE];

/** The „Więcej" screen: everything that is not one of the daily three. */
export const MORE_NAV: readonly NavItem[] = [
  DICTIONARY,
  PROGRESS,
  NOTEBOOK,
  SETTINGS,
];

/** The account menu behind the avatar, above the separator and „Wyloguj się". */
export const ACCOUNT_NAV: readonly NavItem[] = [NOTEBOOK, SETTINGS];

/** Today's „Szybkie akcje" tiles. */
export const QUICK_ACTIONS: readonly NavItem[] = [
  READ,
  REVIEW,
  { ...PROGRESS, label: "Zobacz postęp" },
  DICTIONARY,
];

/** Does this destination need a Fluent account? Asked of the one route table. */
export function navItemRequiresAccount(item: NavItem): boolean {
  return requiresAccount(item.href);
}
