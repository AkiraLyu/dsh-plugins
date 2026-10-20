/**
 * Session Delete — Host half.
 *
 * Exposes one destructive operation, permanently deleting a Session, to the
 * two callers that own it:
 *
 * - `POST /session-delete/delete` for the sidebar action and the
 *   Settings page;
 * - the `delete_sessions` agent tool, which shares the same code path.
 *
 * `GET /session-delete/list` backs the page's archived inventory.
 * Every mutation runs through one serial queue, so two clicks or a tool call
 * cannot interleave.
 *
 * Request rules: the delete route accepts only `application/json`, which a
 * cross-origin browser form cannot send without a successful preflight, and
 * the Host answers no CORS headers. The listener itself binds one local
 * address. Reads are GET and expose no mutation.
 *
 * @module dsh-session-delete
 */
import { deleteSessions, listArchivedSessions, PurgeError } from './delete.js'

const ROUTE = '/session-delete'
const LIST_PATH = `${ROUTE}/list`
const DELETE_PATH = `${ROUTE}/delete`
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_IDS = 20000
const TOOL_NAME = 'delete_sessions'

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'workspaceRegistry', 'sessionPersistence', 'storageDomain', 'tools']

/** Host plugin label. */
export const name = 'dsh-session-delete'

/**
 * Mount the HTTP routes and the agent tool over one shared queue.
 * @param ctx - the Host context owning the services above.
 */
export function apply(ctx) {
  let tail = Promise.resolve()
  /**
   * Run one mutation after every previously accepted mutation.
   * @param task - the operation to serialize.
   * @returns the operation's own result.
   */
  const enqueue = (task) => {
    const run = tail.then(task, task)
    tail = run.then(() => undefined, () => undefined)
    return run
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => handleRequest(ctx, enqueue, req, res) }),
    'dsh-session-delete: HTTP routes'
  )

  ctx.effect(() => ctx.tools.register(deleteTool(ctx, enqueue)), 'dsh-session-delete: delete tool')
}

/**
 * The agent-facing operation. Deletion is explicit: the caller must name the
 * Session ids, so a vague request cannot silently widen into a bulk delete.
 * @param ctx - the Host context.
 * @param enqueue - the shared mutation queue.
 * @returns a registry-ready tool definition.
 */
function deleteTool(ctx, enqueue) {
  return {
    name: TOOL_NAME,
    description:
      'Permanently delete sessions. This cannot be undone: it removes the session log, its projection checkpoint, its reminders, and its workspace entry. ' +
      'A session open in the current view can still be deleted; the view may keep showing it until it is switched away or the process restarts. Shared attachment objects are kept. `ids` is required.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Session ids to delete permanently.'
        }
      },
      required: ['ids'],
      additionalProperties: false
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'array', items: { type: 'string' }, description: 'Session ids whose durable state was removed.' },
          failed: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                code: { type: 'string' },
                message: { type: 'string' }
              },
              required: ['id', 'code', 'message']
            },
            description: 'Session ids that were refused or could not be removed.'
          }
        },
        required: ['deleted', 'failed']
      },
      render: (_args, value) => {
        const lines = []
        if (value.deleted.length === 0) lines.push('Deleted no sessions.')
        else lines.push(`Permanently deleted ${value.deleted.length} session${value.deleted.length === 1 ? '' : 's'}.`)
        if (value.failed.length > 0) {
          lines.push(`Failed for ${value.failed.length}: ${value.failed.map((entry) => `${entry.id} (${entry.code})`).join(', ')}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    async execute(args, exec) {
      const ids = normalizeToolIds(args)
      return enqueue(() => deleteSessions(ctx, ids, exec.signal))
    }
  }
}

/**
 * Validate model-supplied tool arguments.
 * @param args - raw tool arguments.
 * @returns the requested Session ids.
 * @throws {Error} when `ids` is not a non-empty array of non-empty strings.
 */
function normalizeToolIds(args) {
  if (args === null || typeof args !== 'object' || !Array.isArray(args.ids)) {
    throw new Error('ids must be a non-empty array of session ids')
  }
  const ids = [...new Set(args.ids.filter((id) => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) throw new Error('ids must contain at least one non-empty session id')
  return ids
}

/**
 * Answer one request under the plugin's route prefix.
 * @param ctx - the Host context.
 * @param enqueue - the shared mutation queue.
 * @param req - incoming Node request.
 * @param res - Node response the handler owns.
 */
async function handleRequest(ctx, enqueue, req, res) {
  let pathname
  try {
    pathname = new URL(req.url ?? '/', 'http://session-delete').pathname
  } catch {
    send(res, 400, failure('bad_request', 'The request URL is not a path.'))
    return
  }

  try {
    if (pathname === LIST_PATH) {
      if (req.method !== 'GET') {
        send(res, 405, failure('method_not_allowed', 'Use GET to read the archived-session list.'))
        return
      }
      send(res, 200, { ok: true, value: await listArchivedSessions(ctx) })
      return
    }
    if (pathname === DELETE_PATH) {
      if (req.method !== 'POST') {
        send(res, 405, failure('method_not_allowed', 'Use POST to delete archived sessions.'))
        return
      }
      const body = await readJsonBody(req)
      const ids = normalizeRequestIds(body)
      const value = await enqueue(() => deleteSessions(ctx, ids))
      send(res, 200, { ok: true, value })
      return
    }
    send(res, 404, failure('not_found', `No route at ${pathname}.`))
  } catch (error) {
    const code = error instanceof PurgeError ? error.code : 'internal'
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`session-delete: ${req.method ?? '?'} ${pathname} failed (${code}): ${message}`)
    if (!res.headersSent) send(res, code === 'bad_request' ? 400 : 500, failure(code, message))
    else res.destroy()
  }
}

/**
 * Read and parse one bounded JSON request body.
 * @param req - incoming request.
 * @returns the parsed body.
 * @throws {PurgeError} for a non-JSON content type, oversized body, or bad JSON.
 */
async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw new PurgeError('bad_request', 'Expected an application/json request body.')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new PurgeError('bad_request', `Request body exceeds ${MAX_BODY_BYTES} bytes.`)
    chunks.push(chunk)
  }
  if (size === 0) throw new PurgeError('bad_request', 'Request body is empty.')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PurgeError('bad_request', 'Request body is not valid JSON.')
  }
}

/**
 * Extract the deletion ids from a parsed body.
 * @param body - parsed JSON body.
 * @returns deduplicated non-empty string ids.
 * @throws {PurgeError} when `ids` is absent, not an array, or too long.
 */
function normalizeRequestIds(body) {
  const ids = body?.ids
  if (!Array.isArray(ids)) throw new PurgeError('bad_request', 'Expected an "ids" array.')
  if (ids.length > MAX_IDS) throw new PurgeError('bad_request', `Refusing more than ${MAX_IDS} ids per request.`)
  return [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))]
}

/**
 * Write one JSON response.
 * @param res - Node response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable envelope.
 */
function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  })
  res.end(body)
}

/**
 * Build a failure envelope.
 * @param code - stable failure discriminant.
 * @param message - human-readable detail.
 * @returns the wire envelope.
 */
function failure(code, message) {
  return { ok: false, error: { code, message } }
}
