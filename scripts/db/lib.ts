import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Client } from 'pg'

type DatabaseTarget = {
  connectionString: string
  adminConnectionString: string
  databaseName: string
  displayOrigin: string
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function getLocalBinary(name: string) {
  return path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name
  )
}

function parseDatabaseTarget(): DatabaseTarget {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      [
        'DATABASE_URL is not set.',
        'Copy .env.example to .env and point DATABASE_URL at your local Postgres instance.',
        'Then run `npm run db:prepare`.',
      ].join(' ')
    )
  }

  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error(`DATABASE_URL is invalid: ${connectionString}`)
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`DATABASE_URL must use postgres:// or postgresql://, received ${url.protocol}`)
  }

  const databaseName = url.pathname.replace(/^\//, '')
  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name in the path.')
  }

  const adminUrl = new URL(url.toString())
  adminUrl.pathname = '/postgres'

  return {
    connectionString,
    adminConnectionString: adminUrl.toString(),
    databaseName,
    displayOrigin: `${url.hostname}:${url.port || '5432'}`,
  }
}

async function openClient(connectionString: string) {
  const client = new Client({ connectionString })

  try {
    await client.connect()
    return client
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
}

function formatConnectivityError(error: unknown, target: DatabaseTarget) {
  const err = error as NodeJS.ErrnoException & { code?: string }

  if (err?.code === 'ECONNREFUSED') {
    return [
      `Postgres is not reachable at ${target.displayOrigin}.`,
      'Start your local database server/container first, then run `npm run db:prepare`.',
    ].join(' ')
  }

  if (err?.code === '28P01') {
    return 'Postgres rejected the DATABASE_URL credentials. Update DATABASE_URL in .env, then rerun `npm run db:prepare`.'
  }

  if (err?.code === '3D000') {
    return [
      `Database "${target.databaseName}" does not exist on ${target.displayOrigin}.`,
      'Run `npm run db:prepare` to create it, apply migrations, and seed the baseline data.',
    ].join(' ')
  }

  return err?.message ?? 'Unknown Postgres connection error.'
}

function ensureCommandSucceeded(command: string, args: string[]) {
  const binary = getLocalBinary(command)
  const result = spawnSync(binary, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`)
  }
}

export async function ensureDatabaseExists() {
  const target = parseDatabaseTarget()
  const adminClient = await openClient(target.adminConnectionString)

  try {
    const existing = await adminClient.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [target.databaseName]
    )

    if (!existing.rows[0]?.exists) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(target.databaseName)}`)
      console.log(`[db:prepare] Created database "${target.databaseName}".`)
    }
  } catch (error) {
    throw new Error(formatConnectivityError(error, target))
  } finally {
    await adminClient.end()
  }

  return target
}

export async function assertDatabaseReady(options: { requireSeed?: boolean } = {}) {
  const target = parseDatabaseTarget()
  let client: Client | undefined

  try {
    client = await openClient(target.connectionString)

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    const existingTables = new Set(tables.rows.map((row) => row.table_name))
    const requiredTables = ['Corridor', 'Rate', 'User', 'UserIdentifier', 'Session', 'Transfer', 'TransferEvent']
    const missingTables = requiredTables.filter((table) => !existingTables.has(table))

    if (missingTables.length > 0) {
      throw new Error(
        [
          `Database "${target.databaseName}" is reachable but migrations are incomplete.`,
          `Missing tables: ${missingTables.join(', ')}.`,
          'Run `npm run db:prepare`.',
        ].join(' ')
      )
    }

    if (options.requireSeed) {
      const seeded = await client.query<{ has_corridor: boolean; has_rate: boolean }>(
        [
          'SELECT',
          `  EXISTS(SELECT 1 FROM "Corridor" WHERE "baseCurrency" = 'AUD' AND "targetCurrency" = 'NGN') AS has_corridor,`,
          '  EXISTS(SELECT 1 FROM "Rate") AS has_rate',
        ].join('\n')
      )

      if (!seeded.rows[0]?.has_corridor || !seeded.rows[0]?.has_rate) {
        throw new Error(
          [
            `Database "${target.databaseName}" is missing baseline seed data for tests.`,
            'Run `npm run db:prepare`.',
          ].join(' ')
        )
      }
    }

    return target
  } catch (error) {
    const friendly =
      error && typeof error === 'object' && 'code' in error
        ? formatConnectivityError(error, target)
        : error instanceof Error
          ? error.message
          : formatConnectivityError(error, target)
    throw new Error(friendly)
  } finally {
    if (client) {
      await client.end().catch(() => {})
    }
  }
}

export function runPrisma(args: string[]) {
  ensureCommandSucceeded('prisma', args)
}

export function runVitest(args: string[]) {
  ensureCommandSucceeded('vitest', args)
}
