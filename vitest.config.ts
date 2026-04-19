import 'dotenv/config'
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // This repo mutates a single shared Postgres database across many suites.
    // One worker avoids cross-file cleanup races and makes failures
    // deterministic instead of timing-dependent.
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'forks',
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
