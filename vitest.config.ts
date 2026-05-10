import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // This repo mutates a single shared Postgres database across many suites.
    // One worker avoids cross-file cleanup races and makes failures
    // deterministic instead of timing-dependent.
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    sequence: { concurrent: false },
    // Skip stale or in-flight per-subagent worktrees. Vitest's default include
    // would otherwise descend into `.claude/worktrees/agent-*/tests/...` and
    // run obsolete copies of the suite that lag the canonical files in `tests/`.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      ".claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
