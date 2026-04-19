import { assertDatabaseReady, ensureDatabaseExists, runPrisma } from './lib'

async function main() {
  const target = await ensureDatabaseExists()
  console.log(`[db:prepare] Using ${target.displayOrigin}/${target.databaseName}.`)

  runPrisma(['migrate', 'deploy'])
  runPrisma(['db', 'seed'])

  await assertDatabaseReady({ requireSeed: true })
  console.log(`[db:prepare] Database "${target.databaseName}" is ready.`)
}

main().catch((error) => {
  console.error(`[db:prepare] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
