import { assertDatabaseReady } from './lib'

async function main() {
  const target = await assertDatabaseReady({ requireSeed: true })
  console.log(`[db:check] Database "${target.databaseName}" is ready for app and test validation.`)
}

main().catch((error) => {
  console.error(`[db:check] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
