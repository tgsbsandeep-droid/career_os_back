import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use Node environment (no DOM needed for backend tests).
    environment: "node",
    // Glob for test files.
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    // CJS interop: supabase.ts uses module.exports.
    globals: false,
  },
});