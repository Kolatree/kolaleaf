import fs from 'node:fs'
import path from 'node:path'
import { assertDatabaseReady } from '../db/lib'
import { runPrisma } from '../db/lib'
import { runVitest } from '../db/lib'

function normalizeVitestArgs(args: string[]) {
  const hasExplicitMode = args.some((arg) =>
    ['run', '--run', 'watch', '--watch', 'dev', '--dev', 'related', '--related'].includes(arg)
  )

  return hasExplicitMode ? args : ['run', ...args]
}

function collectTestFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []

  const files: string[] = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue

    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath))
      continue
    }

    if (!entry.isFile()) continue
    if (!/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue

    files.push(fullPath)
  }

  return files
}

function splitVitestArgs(args: string[]) {
  const modeArgs = new Set(['run', '--run', 'watch', '--watch', 'dev', '--dev', 'related', '--related'])
  const modes: string[] = []
  const options: string[] = []
  const targets: string[] = []

  for (const arg of args) {
    if (modeArgs.has(arg)) {
      modes.push(arg)
      continue
    }
    if (arg.startsWith('-')) {
      options.push(arg)
      continue
    }
    targets.push(arg)
  }

  return { modes, options, targets }
}

function shouldRunFileByFile(args: string[]) {
  const { modes, targets } = splitVitestArgs(args)
  const activeMode = modes[modes.length - 1] ?? 'run'
  const normalizedMode = activeMode.startsWith('--') ? activeMode.slice(2) : activeMode
  return normalizedMode === 'run' && targets.length === 0
}

function runVitestFileByFile(args: string[]) {
  const { options } = splitVitestArgs(args)
  const files = [...collectTestFiles(path.resolve(process.cwd(), 'src')), ...collectTestFiles(path.resolve(process.cwd(), 'tests'))]
    .map((file) => path.relative(process.cwd(), file))
    .sort()

  for (const file of files) {
    console.log(`[test] vitest ${file}`)
    runVitest(['run', file, ...options])
  }
}

async function main() {
  process.env.FLOAT_BALANCE_NGN ??= '1000000'
  process.env.MIN_FLOAT_BALANCE_NGN ??= '500000'

  try {
    await assertDatabaseReady({ requireSeed: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (reason.includes('missing baseline seed data for tests')) {
      console.log('[test] Restoring baseline seed data before running Vitest.')
      runPrisma(['db', 'seed'])
      await assertDatabaseReady({ requireSeed: true })
    } else {
      console.error(`[test] ${reason}`)
      process.exit(1)
    }
  }

  const args = normalizeVitestArgs(process.argv.slice(2))
  if (shouldRunFileByFile(args)) {
    runVitestFileByFile(args)
    return
  }

  runVitest(args)
}

main().catch((error) => {
  console.error(`[test] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
