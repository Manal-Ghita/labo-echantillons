import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context'
import { SidePanel } from '../components/SidePanel'
import { useSampleQuery } from './useSampleQuery'
import type { Sample } from './api'
import { formatDate, sampleStatus } from './api'
import { getSteps } from '../fabrication/api'
import './lineage.css'

export function SampleLineage({
  sample,
  onCreated,
}: {
  sample: Sample
  onCreated: () => void
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const canSplit = user?.role === 'ADMIN' || user?.id === sample.creatorId
  return (
    <section
      className="fabrication-section sample-lineage"
      aria-labelledby="lineage-title"
    >
      <div className="page-heading">
        <h2 id="lineage-title">Filiation</h2>
        {canSplit && (
          <button
            ref={opener}
            className="button button-secondary"
            onClick={() => setOpen(true)}
          >
            Créer des échantillons enfants
          </button>
        )}
      </div>
      {sample.parent ? (
        <p>
          Parent :{' '}
          <Link to={`/samples/${sample.parent.id}`}>
            {sample.parent.reference} · {sample.parent.name}
          </Link>
        </p>
      ) : (
        <p className="muted">Aucun échantillon parent.</p>
      )}
      {sample.originStep && (
        <p className="muted">
          Étape d’origine : {sample.originStep.operationName} ·{' '}
          {formatDate(sample.originStep.performedAt)}
        </p>
      )}
      {!sample.children?.length ? (
        <p className="muted">Aucun échantillon enfant.</p>
      ) : (
        <ul className="lineage-children">
          {sample.children.map((child) => (
            <li key={child.id}>
              <Link to={`/samples/${child.id}`}>
                {child.reference} · {child.name}
              </Link>
              <span className="muted">{sampleStatus(child.status)}</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <SplitPanel
          sample={sample}
          openerRef={opener}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false)
            onCreated()
          }}
        />
      )}
    </section>
  )
}

function SplitPanel({
  sample,
  openerRef,
  onClose,
  onCreated,
}: {
  sample: Sample
  openerRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onCreated: () => void
}) {
  const { api } = useAuth()
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const errorMessage = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) {
      errorMessage.current?.focus()
      errorMessage.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [error])
  const [originStepId, setOrigin] = useState('')
  const next = useRef(2)
  const [children, setChildren] = useState([
    { key: 0, reference: '', name: '', description: '' },
    { key: 1, reference: '', name: '', description: '' },
  ])
  const pending = useRef(false)
  const load = useCallback(
    (signal: AbortSignal) => getSteps(api, sample.id, signal),
    [api, sample.id],
  )
  const history = useSampleQuery(load)
  function change(
    key: number,
    field: 'reference' | 'name' | 'description',
    value: string,
  ) {
    setDirty(true)
    setChildren((items) =>
      items.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    )
  }
  async function submit() {
    if (pending.current) return
    setError('')
    if (children.some((c) => !c.reference.trim() || !c.name.trim())) {
      setError('La référence et le nom de chaque enfant sont obligatoires.')
      return
    }
    const references = children.map((c) => c.reference.trim())
    if (new Set(references).size !== references.length) {
      setError('Les références des enfants doivent être distinctes.')
      return
    }
    pending.current = true
    setBusy(true)
    try {
      await api.request(`/samples/${encodeURIComponent(sample.id)}/split`, {
        method: 'POST',
        body: {
          ...(originStepId ? { originStepId } : {}),
          children: children.map((c) => ({
            reference: c.reference.trim(),
            name: c.name.trim(),
            ...(c.description ? { description: c.description } : {}),
          })),
        },
      })
      onCreated()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Découpe impossible. Aucun enfant créé.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <SidePanel
      id="split-panel"
      title="Créer des échantillons enfants"
      openerRef={openerRef}
      busy={busy}
      dirty={dirty}
      onClose={onClose}
      footer={(close) => (
        <div className="side-panel-actions">
          <button
            className="button button-primary"
            form="split-form"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Création…' : 'Créer les enfants'}
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={close}
          >
            Annuler
          </button>
        </div>
      )}
    >
      {() => (
        <form
          id="split-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="muted">
            Parent : {sample.reference} · {sample.name}
          </p>
          <p>
            Vous serez propriétaire des nouveaux échantillons. Le statut du
            parent reste inchangé ; ses étapes et son lot ne sont pas copiés.
          </p>
          {error && (
            <p ref={errorMessage} tabIndex={-1} role="alert" className="alert">
              {error}
            </p>
          )}
          <div className="field">
            <label htmlFor="split-origin">Étape d’origine (facultatif)</label>
            <select
              id="split-origin"
              disabled={busy || history.loading}
              value={originStepId}
              onChange={(e) => {
                setOrigin(e.target.value)
                setDirty(true)
              }}
            >
              <option value="">Non renseignée</option>
              {history.data?.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.operationName} · {formatDate(step.performedAt)}
                </option>
              ))}
            </select>
          </div>
          {history.loading && (
            <p role="status">Chargement des étapes du parent…</p>
          )}
          {history.error && (
            <p role="alert">
              {history.error} Vous pouvez créer la filiation sans étape
              d’origine.
              <button type="button" onClick={history.retry}>
                Réessayer les étapes
              </button>
            </p>
          )}
          {children.map((child, index) => (
            <fieldset className="split-child" key={child.key} disabled={busy}>
              <legend>Enfant {index + 1}</legend>
              <div className="field">
                <label htmlFor={`child-reference-${child.key}`}>
                  Référence de l’enfant {index + 1} *
                </label>
                <input
                  id={`child-reference-${child.key}`}
                  value={child.reference}
                  required
                  onChange={(e) =>
                    change(child.key, 'reference', e.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`child-name-${child.key}`}>
                  Nom de l’enfant {index + 1} *
                </label>
                <input
                  id={`child-name-${child.key}`}
                  value={child.name}
                  required
                  onChange={(e) => change(child.key, 'name', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`child-description-${child.key}`}>
                  Description de l’enfant {index + 1} (facultatif)
                </label>
                <textarea
                  id={`child-description-${child.key}`}
                  rows={2}
                  value={child.description}
                  onChange={(e) =>
                    change(child.key, 'description', e.target.value)
                  }
                />
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={children.length === 1}
                onClick={() => {
                  setDirty(true)
                  setChildren((items) =>
                    items.filter((item) => item.key !== child.key),
                  )
                }}
              >
                Retirer l’enfant {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || children.length >= 100}
            onClick={() => {
              setDirty(true)
              setChildren((items) => [
                ...items,
                {
                  key: next.current++,
                  reference: '',
                  name: '',
                  description: '',
                },
              ])
            }}
          >
            Ajouter un enfant
          </button>
        </form>
      )}
    </SidePanel>
  )
}
