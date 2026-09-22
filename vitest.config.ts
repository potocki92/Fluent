import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.test.ts` is the domain: pure functions, reducers, adapters, and it runs
    // in node. `.test.tsx` is a hook or a component, which needs a DOM to mount
    // into and opts into jsdom with a `@vitest-environment` docblock of its own
    // — so six hundred pure tests never pay jsdom's startup cost.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
