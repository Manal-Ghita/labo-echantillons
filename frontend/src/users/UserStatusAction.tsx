import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import type { UserProfile } from '../auth/types'

export function UserStatusAction({
  account,
  onUpdated,
}: {
  account: UserProfile
  onUpdated: () => void
}) {
  const { api, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  const pending = useRef<AbortController | null>(null)
  const focusAfterRequest = useRef(false)
  useEffect(() => () => pending.current?.abort(), [])
  useLayoutEffect(() => {
    if (!busy && focusAfterRequest.current) {
      focusAfterRequest.current = false
      trigger.current?.focus({ preventScroll: true })
    }
  }, [busy])
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.min(
        180,
        (document.documentElement.clientWidth || window.innerWidth) - 16,
      )
      const height = menu.current?.getBoundingClientRect().height || 54
      const viewportHeight = window.innerHeight
      const viewportWidth =
        document.documentElement.clientWidth || window.innerWidth
      if (
        anchor.width &&
        (anchor.bottom <= 0 ||
          anchor.top >= viewportHeight ||
          anchor.right <= 0 ||
          anchor.left >= viewportWidth)
      ) {
        close(false)
        return
      }
      setPosition({
        width,
        left: Math.max(
          8,
          Math.min(anchor.right - width, viewportWidth - width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            anchor.bottom + 6 + height <= viewportHeight - 8
              ? anchor.bottom + 6
              : anchor.top - height - 6,
            viewportHeight - height - 8,
          ),
        ),
      })
    }
    place()
    item.current?.focus({ preventScroll: true })
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close])
  const self = account.id === user?.id
  async function change() {
    if (pending.current || self) return
    if (
      account.isActive &&
      !window.confirm(
        `Désactiver le compte de ${account.name} ? Cette personne ne pourra plus se connecter et ses sessions seront révoquées.`,
      )
    )
      return
    setError(null)
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      await api.request<UserProfile>(
        `/users/${encodeURIComponent(account.id)}/status`,
        {
          method: 'PATCH',
          body: { isActive: !account.isActive },
          signal: controller.signal,
        },
      )
      if (!controller.signal.aborted) onUpdated()
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught)) {
        const status = caught instanceof ApiError ? caught.status : 0
        setError(
          status === 403
            ? 'Vous n’êtes pas autorisé à modifier ce compte.'
            : status === 404
              ? 'Ce compte est introuvable. Actualisez la liste.'
              : status === 409
                ? 'Modification refusée : dernier administrateur actif ou conflit concurrent. Actualisez la liste avant de réessayer.'
                : status === 401
                  ? 'Votre session a expiré. Reconnectez-vous.'
                  : 'Impossible de modifier ce compte. Réessayez.',
        )
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) {
        focusAfterRequest.current = true
        setBusy(false)
      }
    }
  }
  if (self) return <span className="muted account-current">Compte actuel</span>
  return (
    <div className="account-status-action">
      <button
        ref={trigger}
        id={`account-action-${account.id}`}
        type="button"
        className="account-menu-trigger"
        aria-label={`Actions pour ${account.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={`Actions pour ${account.name}`}
            className="account-context-menu"
            style={position}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                close(false)
            }}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                item.current?.focus()
              }
              // Return to the trigger before the browser performs normal tab navigation.
              if (event.key === 'Tab') close()
            }}
          >
            <button
              ref={item}
              role="menuitem"
              tabIndex={-1}
              type="button"
              className={`account-menu-item ${account.isActive ? 'account-menu-danger' : ''}`}
              onClick={() => {
                close()
                void change()
              }}
            >
              {busy
                ? 'Modification…'
                : account.isActive
                  ? 'Désactiver'
                  : 'Réactiver'}
            </button>
          </div>,
          document.body,
        )}
      {error && (
        <p role="alert" className="researcher-field-error">
          {error}
        </p>
      )}
    </div>
  )
}
