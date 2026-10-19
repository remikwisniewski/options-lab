import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      // The pricing library is pure and carries the coverage bar.
      // Canvas and DOM modules are verified in the browser.
      include: ["src/pricing/**/*.js", "src/ui/format.js"],
      reporter: ["text", "html", "lcov"],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
    },
  },
});
