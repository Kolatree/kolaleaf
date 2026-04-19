import { spawnSync } from 'node:child_process'

const CONTAINER_NAME = 'kolaleaf-db'
const IMAGE = 'postgres:16'

function runDocker(args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  })

  if (result.error) {
    throw new Error(
      `Docker is not available: ${result.error.message}. Start Docker Desktop (or your Docker daemon) and rerun \`npm run db:up\`.`
    )
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr?.trim()
    throw new Error(stderr || `docker ${args.join(' ')} failed with exit code ${result.status ?? 1}.`)
  }

  return result
}

function containerExists() {
  const result = runDocker(['ps', '-a', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
    allowFailure: true,
  })

  return result.stdout.trim().split('\n').includes(CONTAINER_NAME)
}

function containerRunning() {
  const result = runDocker(['ps', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
    allowFailure: true,
  })

  return result.stdout.trim().split('\n').includes(CONTAINER_NAME)
}

async function main() {
  if (containerRunning()) {
    console.log(`[db:up] Container "${CONTAINER_NAME}" is already running.`)
    return
  }

  if (containerExists()) {
    runDocker(['start', CONTAINER_NAME])
    console.log(`[db:up] Started existing container "${CONTAINER_NAME}".`)
    return
  }

  runDocker([
    'run',
    '--name',
    CONTAINER_NAME,
    '-e',
    'POSTGRES_PASSWORD=kolaleaf',
    '-p',
    '5433:5432',
    '-d',
    IMAGE,
  ])
  console.log(`[db:up] Created and started container "${CONTAINER_NAME}" from ${IMAGE}.`)
}

main().catch((error) => {
  console.error(`[db:up] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
