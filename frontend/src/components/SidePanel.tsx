import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import './side-panel.css'

// Same native-dialog pattern as step entry, without changing its validated form.
export function SidePanel({
  id,
  title,
  openerRef,
  busy,
  dirty,
  onClose,
  children,
  footer,
}: {
  id: string
  title: string
  openerRef: RefObject<HTMLElement | null>
  busy: boolean
  dirty: boolean
  onClose: () => void
  children: (close: () => void) => ReactNode
  footer: (close: () => void) => ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  function requestClose() {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          'Fermer le panneau et abandonner la saisie non enregistrée ?',
        ))
    )
      onClose()
  }
  useEffect(() => {
    const element = dialog.current!
    const opener = openerRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (element.showModal) element.showModal()
    else element.setAttribute('open', '')
    return () => {
      if (element.close) element.close()
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [openerRef])
  useEffect(() => {
    if (!dirty) return
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [dirty])
  return createPortal(
    <dialog
      ref={dialog}
      id={id}
      className="side-panel"
      aria-labelledby={`${id}-title`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0)
        const first = controls[0],
          last = controls.at(-1)
        if (!first) event.preventDefault()
        else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <header className="side-panel-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          className="button button-secondary"
          autoFocus
          disabled={busy}
          aria-label="Fermer le panneau"
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <div className="side-panel-body">{children(requestClose)}</div>
      <footer className="side-panel-footer">{footer(requestClose)}</footer>
    </dialog>,
    document.body,
  )
}
