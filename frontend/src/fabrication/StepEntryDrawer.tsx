import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Sample } from '../samples/api'
import { StepForm } from './StepForm'
import './step-entry-drawer.css'

export function StepEntryDrawer({
  sample,
  openerRef,
  onCancel,
  onCreated,
}: {
  sample: Sample
  openerRef: RefObject<HTMLElement | null>
  onCancel: () => void
  onCreated: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const dirty = useRef(false)
  const [busy, setBusy] = useState(false)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const markDirty = useCallback(() => {
    dirty.current = true
  }, [])
  function requestClose() {
    if (
      !busy &&
      (!dirty.current ||
        window.confirm('Abandonner la saisie non enregistrée ?'))
    )
      onCancel()
  }
  useEffect(() => {
    const returnFocus = openerRef.current
    const element = dialog.current!
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (element.showModal) element.showModal()
    else element.setAttribute('open', '')
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', preventLoss)
    return () => {
      if (element.close) element.close()
      document.body.style.overflow = overflow
      window.removeEventListener('beforeunload', preventLoss)
      returnFocus?.focus()
    }
  }, [openerRef])
  return createPortal(
    <dialog
      id="step-entry-dialog"
      className="step-drawer"
      ref={dialog}
      aria-labelledby="step-form-title"
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <header className="step-drawer-heading">
        <h2 id="step-form-title">Enregistrer une étape</h2>
        <button
          type="button"
          className="button button-secondary"
          autoFocus
          aria-label="Fermer le panneau"
          disabled={busy}
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <div className="step-drawer-body">
        <StepForm
          sampleId={sample.id}
          sampleReference={sample.reference}
          sampleName={sample.name}
          onCancel={requestClose}
          onCreated={onCreated}
          actionsHost={footer}
          onDirty={markDirty}
          onBusy={setBusy}
        />
      </div>
      <div className="step-drawer-footer" ref={setFooter} />
    </dialog>,
    document.body,
  )
}
