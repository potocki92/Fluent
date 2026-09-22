import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Module boundaries, as rules rather than as prose.
 *
 * `docs/architecture/module-boundaries.md` states which way the arrows point.
 * Until now that was the only place it was stated, and a rule enforced only by
 * prose is a rule that regresses at the next deadline — which is how
 * `TodayPlanItem` came to be exported from a `"use server"` module and imported
 * by eleven others, three of them pure planner functions.
 *
 * PATTERNS COVER BOTH SPELLINGS. `@/actions/foo` and a relative
 * `../../actions/foo` are the same import, so every group below lists the alias
 * form and a globbed form that catches the relative one. Getting only the alias
 * would make the rule trivially avoidable by the one edit most likely to be made
 * in a hurry.
 */

/** `@/x/y` and any relative path ending in `x/y`. */
const both = (path) => [`@/${path}`, `@/${path}/*`, `**/${path}`, `**/${path}/*`];

const NO_REACT = {
  group: ["react", "react-dom", "react-dom/*", "next", "next/*"],
  message:
    "The pure core renders nothing. Move the React or Next.js part into a hook " +
    "or a component and keep this module a function of its arguments.",
};

const NO_ACTIONS = {
  group: both("actions"),
  message:
    "The pure core must not import a Server Action. If you need a TYPE, put it " +
    "in a contracts module (e.g. lib/<domain>/contracts.ts) that neither side " +
    "owns; if you need behaviour, take it as a parameter.",
};

const NO_HOOKS_OR_COMPONENTS = {
  group: [...both("hooks"), ...both("components")],
  message:
    "The pure core does not know about the UI. Invert it: let the hook or the " +
    "component call this module, not the other way round.",
};

const NO_CLIENT_CONSTRUCTORS = {
  group: [
    ...both("lib/supabase/client"),
    ...both("lib/supabase/server"),
    ...both("lib/supabase/service"),
    "**/supabase/client",
    "**/supabase/server",
    "**/supabase/service",
  ],
  message:
    "An adapter TAKES a Supabase client as a parameter; it does not construct " +
    "one. That is what lets the same query serve a browser hook under RLS and a " +
    "Server Component under the cookie-bound client, with one contract.",
};

const NO_SERVICE_ROLE = {
  group: [...both("lib/supabase/service"), "**/supabase/service"],
  message:
    "The service role bypasses RLS entirely. Import it only from a \"use " +
    "server\" module, and only after the acting user has been established from " +
    "the request cookie.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── the pure core ─────────────────────────────────────────────────────────
  // Everything under `src/lib/` is a function of its arguments unless it is one
  // of the adapters named in the next block.
  {
    files: ["src/lib/**/*.ts", "src/lib/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_REACT,
            NO_ACTIONS,
            NO_HOOKS_OR_COMPONENTS,
            NO_CLIENT_CONSTRUCTORS,
          ],
        },
      ],
    },
  },

  // ── the adapters, named one by one ────────────────────────────────────────
  // The exception is deliberately a LIST rather than a glob: an adapter is a
  // decision somebody made, and adding one should be an edit to this file.
  {
    files: [
      // The Supabase seam itself.
      "src/lib/supabase/*.ts",
      // The one module allowed to say who the caller is.
      "src/lib/auth/server.ts",
      // Per-request QueryClient; `cache()` is what ties it to the request.
      "src/lib/query-client.ts",
      // Server-side reads that run on the cookie-bound client.
      "src/lib/learning/queries.ts",
      // Test-only: mounts a hook to assert on its effects.
      "src/lib/testing/render-hook.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [NO_ACTIONS, NO_HOOKS_OR_COMPONENTS] },
      ],
    },
  },

  // ── the one client-state registry ─────────────────────────────────────────
  // `lib/auth/client-state.ts` is the single place that knows WHAT THE BROWSER
  // FORGETS when the signed-in learner changes, and it resets the stores by
  // name. Inverting it — handing the stores in from `AuthProvider` — would move
  // that list to the call site and weaken the invariant it exists to protect:
  // a user-scoped cache entry must never outlive the learner it belongs to, and
  // one forgotten store is a previous learner's level rendered beside the new
  // one's name. The registry is worth more than the arrow's direction here, so
  // the exception is written down rather than worked around.
  {
    files: ["src/lib/auth/client-state.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [NO_REACT, NO_ACTIONS, NO_CLIENT_CONSTRUCTORS] },
      ],
    },
  },

  // ── shared UI primitives ──────────────────────────────────────────────────
  // `components/ui/*` is the design system. A primitive that knows a Server
  // Action, a query hook or a table name is no longer reusable — it is a
  // feature that happens to live in the wrong folder.
  {
    files: ["src/components/ui/**/*.tsx", "src/components/ui/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_ACTIONS,
            {
              group: both("hooks"),
              message:
                "A shared primitive takes its data as props. A hook here makes " +
                "it a feature component in the design system's folder.",
            },
            NO_CLIENT_CONSTRUCTORS,
          ],
        },
      ],
    },
  },

  // ── the service role ──────────────────────────────────────────────────────
  // It bypasses RLS, so it is reachable only from `"use server"` modules and
  // from the one trusted helper they share.
  {
    files: [
      "src/app/**/*.ts",
      "src/app/**/*.tsx",
      "src/components/**/*.ts",
      "src/components/**/*.tsx",
      "src/hooks/**/*.ts",
      "src/hooks/**/*.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_SERVICE_ROLE] }],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
