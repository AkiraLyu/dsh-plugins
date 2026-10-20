/**
 * Durable deletion of Sessions.
 *
 * A Session's durable state is spread over four places:
 *
 * - the JSONL log directory under the persistence root (the conversation
 *   itself, its lock, and any historical format generations);
 * - the `session_projcache` storage-domain row (the persisted projection
 *   checkpoint);
 * - every reminder bound to the Session (their prompt text is Session data and
 *   would otherwise keep trying to deliver into a missing log);
 * - the workspace registry: the owning workspace's `sessionIds` slot, the
 *   registry-global archive set, and the registry-global pin set.
 *
 * Permanent deletion removes all four, so neither the sidebar list nor a
 * future reopen can resolve the Session again. A Session open in this process
 * can still be deleted: its log disappears while the live view keeps rendering
 * from memory until it is switched away or the process restarts, and the
 * confirmation dialog warns about that. Content-addressed attachment objects
 * are intentionally untouched: they are shared by every Session and carry no
 * Session identity of their own.
 *
 * The JSONL backend exposes no delete API, so this module locates the log
 * directory itself. It never trusts a computed directory blindly: when the
 * backend still reports the Session after the directory was removed, the
 * purge fails instead of reporting a false success.
 *
 * @module dsh-session-delete/purge
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The projection-cache storage domain and its only table. */
const PROJECTION_DOMAIN = 'session_projcache'
const PROJECTION_TABLE = 'sessions'
/** Composition rows whose resolved `root` names the two directories we delete from. */
const PERSISTENCE_ROW = '@deepseek-ai/dsh-session-persistence-jsonl'
const STORAGE_ROW = '@deepseek-ai/dsh-storage-json'
/** One session directory: the lock plus exactly one generation log. */
const SESSION_FILE_RE = /^session\.(?:lock|v\d+\.jsonl(?:\.zstd|\.gz)?)$/

/** A purge refusal or failure with a stable machine-readable discriminant. */
export class PurgeError extends Error {
  /**
   * @param code - stable discriminant the UI and tool map to their own text.
   * @param message - diagnostic detail for logs and fallback display.
   */
  constructor(code, message) {
    super(message)
    this.name = 'PurgeError'
    this.code = code
  }
}

/**
 * List every archived Session with the facts the settings page shows.
 * @param ctx - the Host context whose services own the data.
 * @returns archived Sessions, newest first, plus their total log bytes.
 */
export async function listArchivedSessions(ctx) {
  const ids = [...new Set(ctx.workspaceRegistry.archivedSessionIds)]
  const snapshots = await ctx.sessionPersistence.list()
  const byId = new Map(snapshots.map((snapshot) => [snapshot.header.id, snapshot]))
  const titles = await readTitles(ctx, ids)
  const live = ctx.get('sessions')

  const sessions = ids.map((id) => {
    const snapshot = byId.get(id)
    const header = snapshot?.header
    return {
      id,
      title: titles.get(id) ?? null,
      cwd: header?.cwd ?? null,
      createdAt: header?.createdAt ?? null,
      sizeBytes: snapshot?.sizeBytes ?? 0,
      present: snapshot !== undefined,
      live: live?.get(id) !== undefined
    }
  })
  sessions.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))

  return {
    sessions,
    totalBytes: sessions.reduce((total, session) => total + session.sizeBytes, 0)
  }
}

/**
 * Permanently delete Sessions one at a time.
 *
 * Any stored Session is eligible, archived or not. A Session that neither
 * persistence nor the archive set knows reports a per-id failure and changes
 * nothing for that id.
 * @param ctx - the Host context whose services own the data.
 * @param requested - candidate Session ids (already normalized by the caller).
 * @param signal - optional cancellation between ids.
 * @returns which ids were deleted and why the others were not.
 */
export async function deleteSessions(ctx, requested, signal) {
  const ids = [...new Set(requested)]
  const deleted = []
  const failed = []

  for (const id of ids) {
    signal?.throwIfAborted()
    try {
      await deleteOne(ctx, id, signal)
      deleted.push(id)
    } catch (error) {
      const code = error instanceof PurgeError ? error.code : 'delete_failed'
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ id, code, message })
      ctx.logger.warn(`session-delete: deleting session '${id}' failed (${code}): ${message}`)
    }
  }

  return { deleted, failed }
}

/**
 * Delete one Session and verify the backend can no longer see it.
 * @param ctx - the Host context whose services own the data.
 * @param id - the Session id.
 * @param signal - optional cancellation before the destructive steps.
 */
async function deleteOne(ctx, id, signal) {
  signal?.throwIfAborted()
  const persistence = ctx.sessionPersistence

  let snapshot
  let unreadable = false
  try {
    snapshot = await persistence.stat(id)
  } catch (error) {
    unreadable = true
    ctx.logger.warn(`session-delete: session '${id}' could not be read before deletion: ${String(error)}`)
  }

  const root = resolveSessionsRoot(ctx)
  const directories = await sessionDirectories(root, id)
  const archived = ctx.workspaceRegistry.archivedSessionIds.includes(id)
  if (snapshot === undefined && directories.length === 0 && !archived) {
    throw new PurgeError('session_not_found', `session '${id}' is not live, stored, or archived`)
  }
  if (snapshot !== undefined && directories.length === 0) {
    throw new PurgeError('log_not_found', `session '${id}' is still readable but no session directory could be located under ${root}`)
  }
  for (const directory of directories) await rm(directory, { recursive: true, force: true })

  if (unreadable) {
    const leftovers = await sessionDirectories(root, id)
    if (leftovers.length > 0) throw new PurgeError('delete_incomplete', `session '${id}' is still present after its directory was removed`)
  } else {
    const remaining = await persistence.stat(id)
    if (remaining !== undefined) throw new PurgeError('delete_incomplete', `session '${id}' is still readable after its directory was removed`)
  }

  await dropProjectionCheckpoint(ctx, id)
  await dropSchedules(ctx, id)
  await detachFromWorkspaces(ctx, id)
  await ctx.workspaceRegistry.unarchiveSession(id)
  await ctx.workspaceRegistry.unpinSession(id)
}

/**
 * Read durable titles for archived ids in one corpus observation.
 * @param ctx - the Host context.
 * @param ids - archived Session ids.
 * @returns id → title for the ids that carry one.
 */
async function readTitles(ctx, ids) {
  const titles = new Map()
  if (ids.length === 0) return titles
  const query = ctx.get('sessionQuery')
  if (query === undefined) return titles
  try {
    const results = await query.readTitleSnapshots(ids)
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const title = result.value.title?.title
      if (typeof title === 'string' && title.trim() !== '') titles.set(result.sessionId, title)
    }
  } catch (error) {
    ctx.logger.warn(`session-delete: reading archived titles failed: ${String(error)}`)
  }
  return titles
}

/**
 * Remove the persisted projection checkpoint through its storage domain, then
 * fall back to the record document for a cache whose domain is not mounted.
 * @param ctx - the Host context.
 * @param id - the Session whose checkpoint is dropped.
 */
async function dropProjectionCheckpoint(ctx, id) {
  const domain = ctx.storageDomain.get(PROJECTION_DOMAIN)
  if (domain !== undefined) {
    try {
      await domain.table(PROJECTION_TABLE).delete(id)
    } catch (error) {
      ctx.logger.warn(`session-delete: projection checkpoint for '${id}' was not removed from its domain: ${String(error)}`)
    }
  }
  const path = join(resolveStorageRoot(ctx), PROJECTION_DOMAIN, PROJECTION_TABLE, `${id}.json`)
  try {
    await rm(path, { force: true })
  } catch (error) {
    ctx.logger.warn(`session-delete: projection checkpoint document ${path} was not removed: ${String(error)}`)
  }
}

/**
 * Delete every reminder bound to the Session, active or already ended. The
 * schedule service deletes one task at a time by its original binding, so the
 * catalog is the only complete view of both states. A storage failure is fatal
 * for this purge: leaving a reminder behind would keep Session text and a
 * delivery target alive, and the caller's retry is idempotent.
 * @param ctx - the Host context.
 * @param id - the deleted Session.
 */
async function dropSchedules(ctx, id) {
  const schedule = ctx.get('schedule')
  if (schedule === undefined) return
  let entries
  try {
    entries = await schedule.catalog()
  } catch (error) {
    throw new PurgeError('schedule_cleanup_failed', `reminders bound to session '${id}' could not be listed: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const entry of entries) {
    if (entry.sessionId !== id) continue
    try {
      await schedule.delete({ sessionId: id, id: entry.id })
    } catch (error) {
      throw new PurgeError('schedule_cleanup_failed', `reminder '${entry.id}' bound to session '${id}' could not be deleted: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * Drop the Session from every workspace's manual order. An unreadable
 * workspace record is filtered from projections at the next boot anyway.
 * @param ctx - the Host context.
 * @param id - the deleted Session.
 */
async function detachFromWorkspaces(ctx, id) {
  const registry = ctx.workspaceRegistry
  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(id)) continue
    if (typeof workspace.detachSession !== 'function') {
      ctx.logger.warn(`session-delete: workspace '${workspace.id}' cannot detach session '${id}' on this Harness version`)
      continue
    }
    try {
      await workspace.detachSession(id)
    } catch (error) {
      ctx.logger.warn(`session-delete: workspace '${workspace.id}' could not detach session '${id}': ${String(error)}`)
    }
  }
}

/**
 * Root of the JSONL persistence backend. The instance property is the
 * authoritative value; the composition row and DSH home are fallbacks for a
 * backend that hides it.
 * @param ctx - the Host context.
 * @returns absolute session root directory.
 */
export function resolveSessionsRoot(ctx) {
  try {
    const direct = ctx.sessionPersistence?.root
    if (typeof direct === 'string' && direct !== '') return resolve(direct)
  } catch {
    /* fall through to composition and home defaults */
  }
  const configured = composedRoot(ctx, PERSISTENCE_ROW)
  if (configured !== undefined) return resolve(configured)
  return resolve(dshHome(), 'sessions')
}

/**
 * Root of the JSON storage backend (the projection cache's medium).
 * @param ctx - the Host context.
 * @returns absolute storage root directory.
 */
export function resolveStorageRoot(ctx) {
  try {
    const backend = ctx.get('storage')?.backend?.get('json')
    const direct = backend?.root
    if (typeof direct === 'string' && direct !== '') return resolve(direct)
  } catch {
    /* fall through to composition and home defaults */
  }
  const configured = composedRoot(ctx, STORAGE_ROW)
  if (configured !== undefined) return resolve(configured)
  return resolve(dshHome(), 'storages')
}

/**
 * Resolved `root` of one composition row, when the live configuration editor
 * exposes it.
 * @param ctx - the Host context.
 * @param packageName - plugin package name to look up.
 * @returns the configured root, or undefined.
 */
function composedRoot(ctx, packageName) {
  try {
    const editor = ctx.get('configEditor')
    if (editor === undefined) return undefined
    for (const entry of editor.entries()) {
      if (entry.options?.name !== packageName) continue
      const root = entry.options.config?.root
      if (typeof root === 'string' && root !== '') return root
    }
  } catch {
    /* an unavailable editor only costs the fallback */
  }
  return undefined
}

/** The Harness home directory, defaulting to `~/.dsh`. */
function dshHome() {
  const value = process.env.DSH_HOME
  return typeof value === 'string' && value !== '' ? value : join(homedir(), '.dsh')
}

/**
 * Session directories that belong to one id. The JSONL layout groups logs by
 * project directory, so the id is searched one level below the root rather
 * than recomputed from the header cwd: a log whose project key changed or
 * whose cwd no longer exists is still found.
 * @param root - the persistence root.
 * @param id - the Session id.
 * @returns existing session-owned directories, outermost first.
 */
export async function sessionDirectories(root, id) {
  const encoded = encodeSegment(id)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, encoded)
    if (await isSessionDirectory(candidate)) found.push(candidate)
  }
  return found
}

/**
 * Whether a directory holds Session-owned files (the lock or a log
 * generation), so a coincidental directory name is never deleted.
 * @param path - candidate directory.
 * @returns true for a session directory.
 */
async function isSessionDirectory(path) {
  let info
  try {
    info = await stat(path)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  if (!info.isDirectory()) return false
  let entries
  try {
    entries = await readdir(path)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  return entries.some((name) => SESSION_FILE_RE.test(name))
}

/**
 * Encode one string as a single safe path segment.
 *
 * This mirrors the private encoder of the JSONL persistence backend
 * (`@deepseek-ai/dsh-session-persistence-jsonl`), which exports no path
 * helper: safe code units stay literal and every other unit becomes `~XXXX`.
 * @param raw - the Session id.
 * @returns the encoded path segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** Whether a filesystem error reports an absent path. */
function isMissing(error) {
  return error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
