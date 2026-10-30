import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import type { Sample } from '../samples/api'
import { useSampleQuery } from '../samples/useSampleQuery'
import { getSteps } from './api'
import { createPortal } from 'react-dom'
import { StepEntryDrawer } from './StepEntryDrawer'
import { TimelineStep } from './TimelineStep'
import './timeline.css'

export function SampleSteps({
  sample,
  actionHost,
}: {
  sample: Sample
  actionHost: HTMLElement | null
}) {
  const { api, user } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => getSteps(api, sample.id, signal),
    [api, sample.id],
  )
  const history = useSampleQuery(load)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState(false)
  const openButton = useRef<HTMLButtonElement>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(
    () => new Set(),
  )
  const authorized = user?.role === 'ADMIN' || user?.id === sample.creatorId
  const canCreate = authorized && sample.status !== 'ABANDONED'
  return (
    <section className="fabrication-section" aria-labelledby="history-title">
      <div className="page-heading">
        <div>
          <h2 id="history-title">Historique de fabrication</h2>
        </div>
        {canCreate &&
          actionHost &&
          createPortal(
            <button
              ref={openButton}
              aria-expanded={editing}
              aria-controls="step-entry-dialog"
              className="button button-primary"
              onClick={() => {
                setNotice(false)
                setEditing(true)
              }}
            >
              Enregistrer une étape
            </button>,
            actionHost,
          )}
      </div>
      {notice && (
        <p role="status" className="success-notice">
          Étape enregistrée.
        </p>
      )}
      {sample.status === 'ABANDONED' && (
        <p className="muted">
          Cet échantillon est abandonné : aucune nouvelle étape ne peut être
          enregistrée.
        </p>
      )}
      {!authorized && (
        <p className="muted">
          L’enregistrement est réservé au propriétaire ou à ADMIN.
        </p>
      )}
      {history.loading && <p role="status">Chargement de l’historique…</p>}
      {history.error && (
        <div>
          <p role="alert" className="alert">
            {history.error}
          </p>
          <button className="button button-secondary" onClick={history.retry}>
            Réessayer l’historique
          </button>
        </div>
      )}
      {history.data?.length === 0 && (
        <p className="sample-panel">Aucune étape enregistrée.</p>
      )}
      {history.data && (
        <ol className="step-history">
          {history.data.map((step, index) => (
            <TimelineStep
              key={step.id}
              step={step}
              position={index + 1}
              sampleId={sample.id}
              authorized={authorized}
              onUpdated={history.retry}
              expanded={expandedSteps.has(step.id)}
              onToggle={() =>
                setExpandedSteps((current) => {
                  const next = new Set(current)
                  if (next.has(step.id)) next.delete(step.id)
                  else next.add(step.id)
                  return next
                })
              }
            />
          ))}
        </ol>
      )}
      {canCreate && editing && (
        <StepEntryDrawer
          sample={sample}
          openerRef={openButton}
          onCancel={() => setEditing(false)}
          onCreated={() => {
            setEditing(false)
            setNotice(true)
            history.retry()
          }}
        />
      )}
    </section>
  )
}
