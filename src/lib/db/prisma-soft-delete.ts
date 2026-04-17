import { Prisma } from '@/generated/prisma/client'

// Soft-delete extension for User (Step 25).
//
// Archived rows (User.deletedAt IS NOT NULL) drop out of the four
// read operations by default. Callers that genuinely need to see
// archived rows pass `deletedAt: { not: null }` or similar to
// override; the extension respects an explicit `deletedAt` in the
// caller's where clause rather than clobbering it.
//
// We DO NOT filter `update`, `updateMany`, `delete`, `deleteMany`:
// those are rare admin paths and the cleanup script itself needs to
// flip `deletedAt`. Filtering reads is enough to hide archived users
// from the app surface.

function hasExplicitDeletedAt(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false
  return 'deletedAt' in (where as Record<string, unknown>)
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-user',
  query: {
    user: {
      async findMany({ args, query }) {
        args.where = hasExplicitDeletedAt(args.where)
          ? args.where
          : { deletedAt: null, ...(args.where ?? {}) }
        return query(args)
      },
      async findFirst({ args, query }) {
        args.where = hasExplicitDeletedAt(args.where)
          ? args.where
          : { deletedAt: null, ...(args.where ?? {}) }
        return query(args)
      },
      async findUnique({ args, query }) {
        // findUnique's where is constrained to unique-index columns —
        // we still layer the filter so a soft-deleted row is not
        // returned even if the caller looks it up by id or email.
        args.where = hasExplicitDeletedAt(args.where)
          ? args.where
          : ({ deletedAt: null, ...args.where } as typeof args.where)
        return query(args)
      },
      async count({ args, query }) {
        args.where = hasExplicitDeletedAt(args.where)
          ? args.where
          : { deletedAt: null, ...(args.where ?? {}) }
        return query(args)
      },
    },
  },
})
