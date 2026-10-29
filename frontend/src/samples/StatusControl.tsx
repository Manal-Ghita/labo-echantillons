import { useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import type { Sample } from './api'

export function StatusControl({
  sample,
  onUpdated,
}: {
  sample: Sample
  onUpdated: (sample: Sample) => void
}) {
  const { api, user } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  if (user?.role !== 'ADMIN' && user?.id !== sample.creatorId) return null
  const activate = sample.status === 'ABANDONED'
  async function save() {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    try {
      const updated = await api.request<Sample>(
        `/samples/${encodeURIComponent(sample.id)}/status`,
        {
          method: 'PATCH',
          body: { status: activate ? 'ACTIVE' : 'ABANDONED' },
          signal: controller.signal,
        },
      )
      if (!controller.signal.aborted) {
        onUpdated(updated)
        setConfirm(false)
      }
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Changement de statut impossible.',
        )
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <section className="fabrication-section" aria-label="État de l’échantillon">
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {confirm ? (
        <>
          <p>
            {activate
              ? 'Réactiver cet échantillon pour permettre de nouvelles étapes ?'
              : 'Abandonner cet échantillon ? Son historique sera conservé et l’ajout d’étapes sera bloqué.'}
          </p>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Confirmer {activate ? 'la réactivation' : 'l’abandon'}
          </button>{' '}
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Annuler le changement
          </button>
        </>
      ) : (
        <button
          className="button button-secondary"
          onClick={() => setConfirm(true)}
        >
          {activate ? 'Réactiver l’échantillon' : 'Abandonner l’échantillon'}
        </button>
      )}
    </section>
  )
}
