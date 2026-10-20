/**
 * Session Delete — Client half.
 *
 * Adds one page under Settings → Archived sessions. The page lists the
 * registry's archived Sessions with their log size, and deletes them one at a
 * time or all at once through the Host route. Every destructive control opens
 * an inline confirmation first; after a deletion the page reloads its
 * inventory and asks the Session catalog to refresh, so the sidebar drops the
 * removed rows without a page reload.
 *
 * The Client package table does not expose `dsh-client-ui-primitives` to
 * third-party plugins, so the controls are local markup styled only with the
 * theme's `--dsw-alias-*` tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'session-delete'
    /** Host route prefix registered by the Host half. */
    const ROUTE = 'session-delete'

    /** English dictionary, the key-set source of truth mirrored by Chinese. */
    const en = {
      'section.label': 'Archived sessions',
      'menu.purge': 'Delete permanently',
      'dialog.title': 'Delete session permanently?',
      'dialog.description':
        'The log, projection checkpoint, reminders, and workspace entry of “{title}” will be permanently deleted. This cannot be undone.',
      'dialog.keepAttachments': 'Shared attachment objects are kept.',
      'dialog.inUse':
        'This session is in use. Deleting it removes the log immediately; the open conversation can no longer save messages and may start failing. Switch to another session or restart the app afterwards.',
      heading: 'Archived sessions',
      intro:
        'Permanent deletion removes the session log, its projection checkpoint, its reminders, and its workspace entry. It cannot be undone. Attachment objects are shared by all sessions and are kept.',
      summary: '{n} archived sessions · {size}',
      'action.deleteAll': 'Delete all',
      'action.delete': 'Delete',
      'action.cancel': 'Cancel',
      'action.confirmOne': 'Delete permanently',
      'action.confirmAll': 'Delete all permanently',
      'action.retry': 'Retry',
      'state.loading': 'Loading archived sessions…',
      'state.empty': 'No archived sessions.',
      'state.error': 'Could not load archived sessions.',
      'state.deleting': 'Deleting…',
      'confirm.one': 'Permanently delete “{title}”, its log, projection checkpoint, reminders, and workspace entry? This cannot be undone.',
      'confirm.all': 'Permanently delete all {n} archived sessions ({size})? This cannot be undone.',
      'notice.deleted': 'Permanently deleted {n} archived sessions.',
      'notice.partial': 'Deleted {deleted}; {failed} failed: {reason}',
      'notice.failed': 'Nothing was deleted: {reason}',
      'error.notFound': 'The session could not be found; nothing was deleted.',
      'error.logNotFound': 'The session log directory could not be located; nothing was deleted.',
      'error.incomplete': 'The session log is still readable after deletion. Try again.',
      'error.schedule': 'The session\u2019s reminders could not be removed. Try again.',
      'error.request': 'Request failed: {message}',
      'row.created': 'Created {time}',
      'row.missing': 'Log missing',
      'row.live': 'In use',
      'time.locale': 'en-US'
    }

    /** Simplified Chinese dictionary, key-identical to English. */
    const zh = {
      'section.label': '归档会话',
      'menu.purge': '彻底删除',
      'dialog.title': '彻底删除会话？',
      'dialog.description': '将永久删除「{title}」的日志、投影检查点、关联提醒和工作区记录。此操作无法恢复。',
      'dialog.keepAttachments': '共享的附件对象会被保留。',
      'dialog.inUse':
        '该会话正在使用中。删除后日志会立即消失，当前对话将无法继续保存消息并可能开始报错；请切换到其他会话或重启应用后继续使用。',
      heading: '已归档会话',
      intro:
        '彻底删除会永久移除会话日志、投影检查点、与该会话关联的提醒以及对应的工作区记录，无法恢复。附件对象由全部会话共享，不会被删除。',
      summary: '共 {n} 个已归档会话，占用 {size}',
      'action.deleteAll': '全部彻底删除',
      'action.delete': '彻底删除',
      'action.cancel': '取消',
      'action.confirmOne': '永久删除',
      'action.confirmAll': '永久删除全部',
      'action.retry': '重试',
      'state.loading': '正在读取已归档会话…',
      'state.empty': '没有已归档的会话。',
      'state.error': '无法读取已归档会话。',
      'state.deleting': '正在删除…',
      'confirm.one': '将永久删除「{title}」的日志、投影检查点、关联提醒和工作区记录。此操作无法恢复。',
      'confirm.all': '将永久删除全部 {n} 个已归档会话（{size}）。此操作无法恢复。',
      'notice.deleted': '已彻底删除 {n} 个已归档会话。',
      'notice.partial': '已删除 {deleted} 个，{failed} 个失败：{reason}',
      'notice.failed': '未删除任何会话：{reason}',
      'error.notFound': '找不到该会话，未删除任何内容。',
      'error.logNotFound': '无法定位该会话的日志目录，未删除。',
      'error.incomplete': '删除后仍能读取到该会话的日志，请重试。',
      'error.schedule': '该会话的关联提醒未能删除，请重试。',
      'error.request': '无法完成请求：{message}',
      'row.created': '创建于 {time}',
      'row.missing': '日志缺失',
      'row.live': '使用中',
      'time.locale': 'zh-CN'
    }

    /** Required browser services. */
    const inject = ['slots', 'locale', 'sessions']

    /** Styles scoped under `.asp-root`; only theme alias tokens carry color. */
    const CSS = `
.asp-root { display: flex; flex-direction: column; gap: 12px; max-width: 760px; color: var(--dsw-alias-label-primary); }
.asp-heading { margin: 0; font-size: 18px; font-weight: 600; line-height: 26px; }
.asp-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.asp-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.asp-summaryText { min-width: 0; }
.asp-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.asp-item { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
.asp-row { display: flex; align-items: flex-start; gap: 12px; }
.asp-main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.asp-title { font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asp-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.asp-path { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asp-badge { flex: none; padding: 0 6px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 4px; color: var(--dsw-alias-state-warn-primary); font-size: 11px; line-height: 16px; }
.asp-badgeLive { border-color: var(--dsw-alias-state-idle-primary); color: var(--dsw-alias-state-idle-primary); }
.asp-actions { display: flex; flex: none; align-items: center; gap: 8px; }
.asp-button { box-sizing: border-box; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.asp-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.asp-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.asp-button:disabled { opacity: 0.5; cursor: default; }
.asp-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.asp-confirm { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.asp-confirmText { margin: 0; font-size: 13px; line-height: 20px; }
.asp-confirmActions { display: flex; justify-content: flex-end; gap: 8px; }
.asp-state { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.asp-notice { margin: 0; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; font-size: 13px; line-height: 20px; }
.asp-noticeSuccess { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.asp-noticeError { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.asp-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.asp-menu-item-wrap { position: relative; }
.asp-menu-separator { height: 0.5px; margin: 3px 2px; background: var(--dsw-alias-border-l2); }
.asp-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; padding: 6px 8px; border: none; border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); text-align: left; }
.asp-menu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.asp-menu-item:focus-visible:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.asp-menu-item:disabled { opacity: 0.4; cursor: not-allowed; }
.asp-menu-item-icon { display: inline-flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; color: var(--dsw-alias-menu-icon); }
.asp-menu-item-icon svg { width: 14px; height: 14px; }
.asp-menu-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asp-menu-danger, .asp-menu-danger .asp-menu-item-icon { color: var(--dsw-alias-state-error-primary); }
.asp-menu-danger:hover:not(:disabled), .asp-menu-danger:focus-visible:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); outline: none; }
.asp-modal-root { pointer-events: auto; position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px; }
.asp-modal-mask { position: absolute; inset: var(--dsh-frame-chrome-top, 0px) 0 0; backdrop-filter: var(--dsw-mask-blur); }
.asp-modal-mask::after { content: ""; position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); }
.asp-modal-dialog { box-sizing: border-box; position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); padding: 0 0 24px; overflow: hidden; border: 0; border-radius: var(--dsw-radius-panel); background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); }
.asp-modal-dialog:focus { outline: none; }
.asp-modal-confirmation { width: min(440px, 100%); max-height: calc(100dvh - 48px); }
.asp-modal-content { display: flex; flex-direction: column; width: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.asp-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }
.asp-modal-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.asp-modal-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary); }
.asp-modal-close:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.asp-modal-close:disabled { opacity: 0.4; cursor: default; }
.asp-modal-description { margin: 0; padding: 0 24px; font-size: 14px; line-height: 22px; font-weight: 400; color: var(--dsw-alias-label-primary); }
.asp-modal-body { display: flex; flex-direction: column; min-width: 0; margin-top: 20px; padding: 0 24px; }
.asp-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px; }
.asp-dialog-warning { display: flex; align-items: flex-start; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.asp-dialog-warning p { margin: 0; }
.asp-dialog-warning-icon { flex: none; display: inline-flex; margin-top: 2px; color: var(--dsw-alias-state-error-primary); }
.asp-dialog-live { margin: 10px 0 0; color: var(--dsw-alias-state-warn-primary); font-size: 13px; line-height: 20px; }
.asp-dialog-error { margin: 12px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; }
.asp-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.asp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.asp-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }
.asp-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.asp-btn-danger { color: var(--dsw-alias-state-error-primary); }
`

    /** One failed Host request, carrying its stable code for localized text. */
    class RequestError extends Error {
      constructor(code, message) {
        super(message)
        this.name = 'RequestError'
        this.code = code
      }
    }

    /**
     * Call one Host route relative to the page base, so a reverse-proxied GUI
     * prefix and the desktop shell's `dsh-app://` page both stay same-origin.
     * @param action - `list` or `delete`.
     * @param body - JSON body for a mutation; omitted for a read.
     * @returns the `value` of a successful envelope.
     */
    async function request(action, body) {
      const url = new URL(`${ROUTE}/${action}`, document.baseURI)
      const init =
        body === undefined
          ? {}
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      let response
      try {
        response = await fetch(url, init)
      } catch (error) {
        throw new RequestError('unreachable', error instanceof Error ? error.message : String(error))
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new RequestError('bad_response', `Host returned HTTP ${response.status}`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        throw new RequestError(
          payload?.error?.code ?? 'http_error',
          payload?.error?.message ?? `Host returned HTTP ${response.status}`
        )
      }
      return payload.value
    }

    /** Pending confirmation for one Session-row delete, shared by the menu row and its dialog. */
    const purgeRequest = createValueStore(null)

    /**
     * One tiny observable source for the shared confirmation request. The slot
     * framework binds a `hooks` source into a React hook; no client store
     * package is imported.
     * @param initial - starting snapshot.
     * @returns getSnapshot/subscribe/set.
     */
    function createValueStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: (next) => {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        }
      }
    }

    /**
     * Bind the page's dictionaries and register the three surfaces: the
     * Settings page, the archived Session's row menu, and the confirmation
     * dialog that replaces the immediate destructive click.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(
        () => {
          if (typeof document === 'undefined') return () => undefined
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-session-delete'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        },
        'dsh-session-delete: styles'
      )
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: dictionaries')
      const t = ctx.locale.bind(NS)
      const refreshSessions = () => {
        void ctx.sessions.refresh().catch(() => undefined)
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'archived-sessions',
            order: 40,
            label: () => t('section.label'),
            locale: NS,
            inject: () => ({
              listArchived: () => request('list'),
              deleteArchived: (ids) => request('delete', { ids }),
              refreshSessions
            })
          },
          ArchivedSessionsSection
        )
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'dsh-session-delete.purge',
            order: 500,
            locale: NS,
            inject: () => ({ reviewSessionPurge: (value) => purgeRequest.set(value) })
          },
          PurgeSessionMenuItem
        )
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-session-delete.confirm',
            locale: NS,
            inject: () => ({
              hooks: { purgeRequest },
              settleSessionPurge: () => purgeRequest.set(null),
              deleteSession: (sessionId) => request('delete', { ids: [sessionId] }),
              refreshSessions
            })
          },
          SessionPurgeDialog
        )
      )
    }

    /**
     * The `...` menu row for one Session, present for every Session in every
     * filter mode. Selecting it closes the menu and raises the confirmation
     * dialog instead of deleting immediately. Whether the Session is currently
     * open or running travels with the request so the dialog can add its
     * warning; the deletion itself is never refused for a live Session.
     * @param props - owner row props, the menu close hook, the Session catalog
     *   selector, the request raiser, and localized copy.
     * @returns the menu row.
     */
    function PurgeSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useSessions, reviewSessionPurge, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      const inUse = useSessions((state) => {
        const summary = state.byId[sessionId]
        if (summary === undefined) return false
        return summary.running === true || (summary.retainedBy?.mainView ?? 0) > 0
      })
      return h(
        'div',
        { className: 'asp-menu-item-wrap' },
        h('div', { className: 'asp-menu-separator', role: 'separator' }),
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'asp-menu-item asp-menu-danger',
            onClick: () => {
              setMenuOpen(false)
              reviewSessionPurge({ sessionId, title: displayTitle, inUse })
            }
          },
          h('span', { className: 'asp-menu-item-icon', 'aria-hidden': 'true' }, trashIcon()),
          h('span', { className: 'asp-menu-item-label' }, t('menu.purge'))
        )
      )
    }

    /**
     * The `shell.overlay` entry: one dialog per pending request. A new request
     * remounts the form, so in-flight state never leaks between Sessions.
     * @param props - the request hook and the injected deletion callbacks.
     * @returns the open dialog, or null while nothing is pending.
     */
    function SessionPurgeDialog({ usePurgeRequest, settleSessionPurge, deleteSession, refreshSessions, t }) {
      const request = usePurgeRequest((value) => value)
      if (request === null) return null
      return h(SessionPurgeForm, {
        key: request.sessionId,
        request,
        settleSessionPurge,
        deleteSession,
        refreshSessions,
        t
      })
    }

    /**
     * One request's dialog form: confirmation, pending state, and a localized
     * Host failure. Success closes the dialog and refreshes the Session list.
     * @param props - the request, settlement, the Host call, and copy.
     * @returns the modal element tree.
     */
    function SessionPurgeForm({ request, settleSessionPurge, deleteSession, refreshSessions, t }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const close = () => {
        if (!busy) settleSessionPurge()
      }
      const confirm = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          const value = await deleteSession(request.sessionId)
          const failed = Array.isArray(value?.failed) ? value.failed : []
          if (failed.length > 0) {
            setError(describeFailure(failed[0], t))
            setBusy(false)
            return
          }
          setBusy(false)
          settleSessionPurge()
          refreshSessions()
        } catch (caught) {
          setError(t('error.request', { message: caught instanceof Error ? caught.message : String(caught) }))
          setBusy(false)
        }
      }
      const title = sessionTitle({ title: request.title, id: request.sessionId })
      return h(
        ModalShell,
        {
          title: t('dialog.title'),
          description: t('dialog.description', { title }),
          closeLabel: t('action.cancel'),
          onClose: close,
          busy,
          footer: [
            h(
              'button',
              {
                type: 'button',
                className: 'asp-btn asp-btn-outline',
                disabled: busy,
                onClick: close,
                key: 'cancel',
                'data-modal-autofocus': true
              },
              t('action.cancel')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'asp-btn asp-btn-outline asp-btn-danger',
                disabled: busy,
                onClick: confirm,
                key: 'confirm'
              },
              busy ? t('state.deleting') : t('action.confirmOne')
            )
          ]
        },
        h(
          'div',
          { className: 'asp-dialog-warning' },
          h('span', { className: 'asp-dialog-warning-icon', 'aria-hidden': 'true' }, warningIcon()),
          h('p', null, t('dialog.keepAttachments'))
        ),
        request.inUse === true
          ? h('p', { className: 'asp-dialog-live', role: 'alert' }, t('dialog.inUse'))
          : null,
        error === null ? null : h('p', { className: 'asp-dialog-error', role: 'alert' }, error)
      )
    }

    /**
     * A minimal host-styled modal: body portal, mask dismissal, initial focus,
     * Escape close, and a Tab loop across its own enabled controls. The
     * primitive package is not importable by a plugin, so this copies its
     * markup shape and token-only styling.
     * @param props - dialog chrome, close behavior, and the body/footer.
     * @returns the portal element.
     */
    function ModalShell({ title, description, closeLabel, onClose, busy, footer, children }) {
      const dialogRef = useRef(null)
      const closeRef = useRef(onClose)
      closeRef.current = onClose

      useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement
        if (dialog !== null) {
          const target = dialog.querySelector('[data-modal-autofocus]') ?? dialog.querySelector('button') ?? dialog
          target.focus()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !event.shiftKey) {
            event.preventDefault()
            if (!event.repeat) closeRef.current()
            return
          }
          if (event.key !== 'Tab' || dialog === null) return
          const focusables = [
            ...dialog.querySelectorAll(
              'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
            )
          ].filter((element) => element.getClientRects().length > 0)
          if (focusables.length === 0) {
            event.preventDefault()
            dialog.focus()
            return
          }
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          const active = document.activeElement
          if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
        }
      }, [])

      return ReactDOM.createPortal(
        h(
          'div',
          { className: 'asp-modal-root', role: 'presentation' },
          h('div', {
            className: 'asp-modal-mask',
            'aria-hidden': 'true',
            onClick: () => {
              if (!busy) onClose()
            }
          }),
          h(
            'div',
            {
              ref: dialogRef,
              className: 'asp-modal-dialog asp-modal-confirmation',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': title,
              tabIndex: -1
            },
            h(
              'div',
              { className: 'asp-modal-content' },
              h(
                'div',
                { className: 'asp-modal-header' },
                h('h2', { className: 'asp-modal-title' }, title),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'asp-modal-close',
                    'aria-label': closeLabel,
                    disabled: busy,
                    onClick: onClose
                  },
                  closeIcon()
                )
              ),
              h('p', { className: 'asp-modal-description' }, description),
              h('div', { className: 'asp-modal-body' }, children)
            ),
            h('div', { className: 'asp-modal-footer' }, footer)
          )
        ),
        document.body
      )
    }

    /** Trash glyph for the menu row. */
    function trashIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
        h('path', { d: 'M4 7h16M9 7V5h6v2M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5' })
      )
    }

    /** Warning triangle for the confirmation body. */
    function warningIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
        h('path', { d: 'M12 3.5 21 20H3z' }),
        h('path', { d: 'M12 9v5M12 17h.01' })
      )
    }

    /** Close glyph for the modal header. */
    function closeIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          'aria-hidden': 'true'
        },
        h('path', { d: 'M6 6l12 12M18 6 6 18' })
      )
    }

    /**
     * The Settings page: inventory, inline confirmations, and result notices.
     * Injected calls are read through a ref, so the mount-only inventory read
     * cannot restart because the slot supplied fresh closures.
     * @param props - localized `t` plus the injected Host calls.
     * @returns the section element tree.
     */
    function ArchivedSessionsSection({ t, listArchived, deleteArchived, refreshSessions }) {
      const api = useRef({ listArchived, deleteArchived, refreshSessions })
      api.current = { listArchived, deleteArchived, refreshSessions }

      const [state, setState] = useState({ status: 'loading', sessions: [], totalBytes: 0 })
      const [pending, setPending] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const requestSeq = useRef(0)

      /** Read the Host inventory, ignoring a superseded response. */
      const load = useCallback(async () => {
        const seq = ++requestSeq.current
        setState((current) => ({ ...current, status: 'loading' }))
        try {
          const value = await api.current.listArchived()
          if (seq !== requestSeq.current) return
          setState({
            status: 'ready',
            sessions: Array.isArray(value?.sessions) ? value.sessions : [],
            totalBytes: typeof value?.totalBytes === 'number' ? value.totalBytes : 0
          })
        } catch {
          if (seq !== requestSeq.current) return
          setState({ status: 'error', sessions: [], totalBytes: 0 })
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const sessions = state.sessions
      const sizeText = formatBytes(state.totalBytes)
      const deletableIds = sessions.map((session) => session.id)
      const confirmIds =
        pending === null ? [] : pending.scope === 'all' ? deletableIds : pending.scope === 'one' ? [pending.id] : []

      /** Run the confirmed deletion, then reload the inventory and session catalog. */
      const confirm = useCallback(async () => {
        if (pending === null || busy || confirmIds.length === 0) return
        setBusy(true)
        setNotice(null)
        try {
          const value = await api.current.deleteArchived(confirmIds)
          const deleted = Array.isArray(value?.deleted) ? value.deleted : []
          const failed = Array.isArray(value?.failed) ? value.failed : []
          if (failed.length === 0) {
            setNotice({ tone: 'success', text: t('notice.deleted', { n: deleted.length }) })
          } else if (deleted.length === 0) {
            setNotice({ tone: 'error', text: t('notice.failed', { reason: describeFailure(failed[0], t) }) })
          } else {
            setNotice({
              tone: 'error',
              text: t('notice.partial', {
                deleted: deleted.length,
                failed: failed.length,
                reason: describeFailure(failed[0], t)
              })
            })
          }
          setPending(null)
          await load()
          api.current.refreshSessions()
        } catch (error) {
          setNotice({
            tone: 'error',
            text: t('error.request', { message: error instanceof Error ? error.message : String(error) })
          })
        } finally {
          setBusy(false)
        }
      }, [pending, busy, confirmIds, load, t])

      const askOne = (session) => {
        if (busy) return
        setNotice(null)
        setPending({ scope: 'one', id: session.id })
      }

      const askAll = () => {
        if (busy || deletableIds.length === 0) return
        setNotice(null)
        setPending({ scope: 'all' })
      }

      const cancel = () => {
        if (!busy) setPending(null)
      }

      const confirmAll = pending !== null && pending.scope === 'all'
      const confirmOneId = pending !== null && pending.scope === 'one' ? pending.id : null

      return h(
        'div',
        { className: 'asp-root' },
        h('h2', { className: 'asp-heading', key: 'heading' }, t('heading')),
        h('p', { className: 'asp-intro', key: 'intro' }, t('intro')),
        state.status === 'ready' && sessions.length > 0
          ? h(
              'div',
              { className: 'asp-summary', key: 'summary' },
              h('span', { className: 'asp-summaryText' }, t('summary', { n: sessions.length, size: sizeText })),
              h(
                'button',
                {
                  type: 'button',
                  className: 'asp-button asp-danger',
                  disabled: busy || pending !== null || deletableIds.length === 0,
                  onClick: askAll,
                  key: 'deleteAll'
                },
                t('action.deleteAll')
              )
            )
          : null,
        confirmAll
          ? h(
              'div',
              { className: 'asp-confirm', key: 'confirmAll', role: 'group', 'aria-label': t('action.confirmAll') },
              h('p', { className: 'asp-confirmText' }, t('confirm.all', { n: deletableIds.length, size: sizeText })),
              h(
                'div',
                { className: 'asp-confirmActions' },
                h('button', { type: 'button', className: 'asp-button', disabled: busy, onClick: cancel }, t('action.cancel')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'asp-button asp-danger',
                    disabled: busy || deletableIds.length === 0,
                    onClick: confirm
                  },
                  busy ? t('state.deleting') : t('action.confirmAll')
                )
              )
            )
          : null,
        state.status === 'loading'
          ? h('p', { className: 'asp-state', key: 'loading', role: 'status' }, t('state.loading'))
          : state.status === 'error'
            ? h(
                'div',
                { className: 'asp-inline', key: 'error', role: 'alert' },
                h('span', { className: 'asp-state' }, t('state.error')),
                h('button', { type: 'button', className: 'asp-button', onClick: () => void load() }, t('action.retry'))
              )
            : sessions.length === 0
              ? h('p', { className: 'asp-state', key: 'empty' }, t('state.empty'))
              : h(
                  'ul',
                  { className: 'asp-list', key: 'list' },
                  sessions.map((session) => {
                    const confirming = confirmOneId === session.id
                    return h(
                      'li',
                      { className: 'asp-item', key: session.id },
                      h(
                        'div',
                        { className: 'asp-row' },
                        h(
                          'div',
                          { className: 'asp-main' },
                          h('div', { className: 'asp-title', title: sessionTitle(session) }, sessionTitle(session)),
                          h(
                            'div',
                            { className: 'asp-meta' },
                            session.createdAt === null
                              ? null
                              : h('span', null, t('row.created', { time: formatTime(session.createdAt, t('time.locale')) })),
                            h('span', null, formatBytes(session.sizeBytes)),
                            session.cwd === null
                              ? null
                              : h('span', { className: 'asp-path', title: session.cwd }, shortPath(session.cwd)),
                            session.present ? null : h('span', { className: 'asp-badge' }, t('row.missing')),
                            session.live ? h('span', { className: 'asp-badge asp-badgeLive' }, t('row.live')) : null
                          )
                        ),
                        h(
                          'div',
                          { className: 'asp-actions' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'asp-button asp-danger',
                              disabled: busy || pending !== null,
                              'aria-label': `${t('action.delete')}: ${sessionTitle(session)}`,
                              onClick: () => askOne(session)
                            },
                            t('action.delete')
                          )
                        )
                      ),
                      confirming
                        ? h(
                            'div',
                            { className: 'asp-confirm', role: 'group', 'aria-label': t('action.confirmOne') },
                            h('p', { className: 'asp-confirmText' }, t('confirm.one', { title: sessionTitle(session) })),
                            h(
                              'div',
                              { className: 'asp-confirmActions' },
                              h(
                                'button',
                                { type: 'button', className: 'asp-button', disabled: busy, onClick: cancel },
                                t('action.cancel')
                              ),
                              h(
                                'button',
                                { type: 'button', className: 'asp-button asp-danger', disabled: busy, onClick: confirm },
                                busy ? t('state.deleting') : t('action.confirmOne')
                              )
                            )
                          )
                        : null
                    )
                  })
                ),
        notice === null
          ? null
          : h(
              'p',
              {
                className: `asp-notice ${notice.tone === 'error' ? 'asp-noticeError' : 'asp-noticeSuccess'}`,
                key: 'notice',
                role: notice.tone === 'error' ? 'alert' : 'status'
              },
              notice.text
            )
      )
    }

    /**
     * Localized explanation of one Host-side failure.
     * @param failure - `{ code, message }` from the delete result.
     * @param t - bound translator.
     * @returns display text.
     */
    function describeFailure(failure, t) {
      switch (failure?.code) {
        case 'session_not_found':
          return t('error.notFound')
        case 'log_not_found':
          return t('error.logNotFound')
        case 'delete_incomplete':
          return t('error.incomplete')
        case 'schedule_cleanup_failed':
          return t('error.schedule')
        default:
          return typeof failure?.message === 'string' ? failure.message : t('state.error')
      }
    }

    /** The durable title, or the id when the log had no title. */
    function sessionTitle(session) {
      return typeof session?.title === 'string' && session.title.trim() !== '' ? session.title : String(session?.id ?? '')
    }

    /**
     * Render a byte count with one decimal below 100 and whole units above.
     * @param bytes - stored log size.
     * @returns display text.
     */
    function formatBytes(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let amount = value
      let unit = 0
      while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024
        unit += 1
      }
      return `${amount.toFixed(unit === 0 || amount >= 100 ? 0 : 1)} ${units[unit]}`
    }

    /**
     * Format a creation timestamp in the active UI language.
     * @param ms - epoch milliseconds.
     * @param locale - BCP 47 tag from the dictionary.
     * @returns display text.
     */
    function formatTime(ms, locale) {
      try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
      } catch {
        return new Date(ms).toISOString()
      }
    }

    /**
     * Shorten a project path to its last two segments for the row line.
     * @param path - absolute project directory.
     * @returns display text.
     */
    function shortPath(path) {
      const parts = String(path)
        .split(/[\\/]+/)
        .filter((part) => part !== '')
      if (parts.length <= 2) return String(path)
      return `…/${parts.slice(-2).join('/')}`
    }

    return { inject, apply }
  }
})
