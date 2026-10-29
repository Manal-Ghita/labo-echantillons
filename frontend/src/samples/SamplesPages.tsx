import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import {
  createSample,
  formatDate,
  getSample,
  listSamples,
  sampleStatus,
} from './api'
import { useSampleQuery } from './useSampleQuery'
import { SampleSteps } from '../fabrication/SampleSteps'
import { NumericSearch } from './NumericSearch'
import { StatusControl } from './StatusControl'
import type { Sample } from './api'

function QueryError({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  return (
    <div className="query-error">
      <p className="alert" role="alert">
        {message}
      </p>
      <button className="button button-secondary" onClick={retry}>
        Réessayer
      </button>
    </div>
  )
}

export function SamplesPage() {
  const { api } = useAuth()
  const [search, setSearch] = useSearchParams()
  const q = search.get('q')?.trim() || ''
  const definitionId = search.get('parameterDefinitionId') || ''
  const min = search.get('min') || ''
  const max = search.get('max') || ''
  const [advanced, setAdvanced] = useState(false)
  const load = useCallback(
    (signal: AbortSignal) =>
      listSamples(api, q, signal, {
        parameterDefinitionId: definitionId,
        min,
        max,
      }),
    [api, q, definitionId, min, max],
  )
  const result = useSampleQuery(load)
  return (
    <section className="page">
      <p className="eyebrow">ESPACE DU LABORATOIRE</p>
      <div className="page-heading">
        <div>
          <h1>Échantillons</h1>
          <p className="muted">
            Retrouver chaque échantillon, suivre son parcours.
          </p>
        </div>
        <Link className="button button-primary" to="/samples/new">
          Créer un échantillon
        </Link>
      </div>
      <form
        key={`${q}:${definitionId}:${min}:${max}`}
        className="sample-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          const value = String(
            new FormData(event.currentTarget).get('q') || '',
          ).trim()
          const params = new URLSearchParams(value ? { q: value } : {})
          const form = new FormData(event.currentTarget)
          for (const key of ['parameterDefinitionId', 'min', 'max']) {
            const field = String(form.get(key) || '').trim()
            if (field) params.set(key, field)
          }
          setSearch(params)
        }}
      >
        <div className="field">
          <label htmlFor="sample-search">Référence ou nom</label>
          <input
            id="sample-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Ex. K24-017"
          />
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setAdvanced((current) => !current)}
          aria-expanded={advanced || !!definitionId || !!min || !!max}
        >
          Recherche par paramètres
        </button>
        {(advanced || definitionId || min || max) && (
          <NumericSearch definitionId={definitionId} min={min} max={max} />
        )}
        <button className="button button-primary" type="submit">
          Rechercher
        </button>
        {(q || definitionId || min || max) && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setSearch({})}
          >
            Effacer la recherche
          </button>
        )}
      </form>
      {result.loading && <p role="status">Chargement des échantillons…</p>}
      {result.error && (
        <QueryError message={result.error} retry={result.retry} />
      )}
      {result.data && (
        <>
          <p className="muted" role="status">
            {result.data.length} échantillon(s){q ? ` pour « ${q} »` : ''}
          </p>
          {result.data.length === 0 ? (
            <div className="placeholder-card">
              <h2>
                {q || definitionId ? 'Aucun résultat' : 'Aucun échantillon'}
              </h2>
              <p>
                {q
                  ? 'Essayez une autre référence ou un autre nom.'
                  : 'Créez un premier échantillon pour commencer.'}
              </p>
            </div>
          ) : (
            <ul className="sample-list">
              {result.data.map((sample) => (
                <li className="sample-card" key={sample.id}>
                  <div>
                    <p className="sample-reference">{sample.reference}</p>
                    <h2>
                      <Link to={`/samples/${encodeURIComponent(sample.id)}`}>
                        {sample.name}
                      </Link>
                    </h2>
                  </div>
                  <span className="status-tag">
                    {sampleStatus(sample.status)}
                  </span>
                  <p className="sample-description">
                    {sample.description || 'Aucune description.'}
                  </p>
                  <p className="muted">
                    Créé le{' '}
                    <time dateTime={sample.createdAt}>
                      {formatDate(sample.createdAt)}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export function SampleDetailPage() {
  const { api, user } = useAuth()
  const { id = '' } = useParams()
  const load = useCallback(
    (signal: AbortSignal) => getSample(api, id, signal),
    [api, id],
  )
  const result = useSampleQuery(load)
  const [updated, setUpdated] = useState<Sample | null>(null)
  const sample = updated?.id === result.data?.id ? updated : result.data
  return (
    <section className="page">
      <Link className="back-link" to="/samples">
        ← Tous les échantillons
      </Link>
      {result.loading && <p role="status">Chargement de l’échantillon…</p>}
      {result.error && (
        <QueryError message={result.error} retry={result.retry} />
      )}
      {sample && (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow sample-reference">{sample.reference}</p>
              <h1>{sample.name}</h1>
            </div>
            <span className="status-tag">{sampleStatus(sample.status)}</span>
          </div>
          <div className="sample-panel">
            <h2>Description</h2>
            <p className="sample-description">
              {sample.description || 'Aucune description.'}
            </p>
            <dl className="sample-facts">
              <div>
                <dt>Référence</dt>
                <dd>{sample.reference}</dd>
              </div>
              <div>
                <dt>Identifiant technique</dt>
                <dd>{sample.id}</dd>
              </div>
              <div>
                <dt>Propriétaire (identifiant)</dt>
                <dd>
                  {sample.creatorId}
                  {sample.creatorId === user?.id ? ' (vous)' : ''}
                </dd>
              </div>
              <div>
                <dt>Statut</dt>
                <dd>{sampleStatus(sample.status)}</dd>
              </div>
              <div>
                <dt>Création</dt>
                <dd>
                  <time dateTime={sample.createdAt}>
                    {formatDate(sample.createdAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Dernière modification</dt>
                <dd>
                  <time dateTime={sample.updatedAt}>
                    {formatDate(sample.updatedAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
          <StatusControl
            key={`status:${sample.id}:${sample.status}`}
            sample={sample}
            onUpdated={setUpdated}
          />
          <SampleSteps
            key={`steps:${sample.id}:${sample.status}`}
            sample={sample}
          />
        </>
      )}
    </section>
  )
}

export function CreateSamplePage() {
  const { api } = useAuth()
  const navigate = useNavigate()
  const [reference, setReference] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit() {
    if (pending.current) return
    setError(null)
    setDetails([])
    if (!reference.trim() || !name.trim()) {
      setError('La référence et le nom sont obligatoires.')
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const sample = await createSample(
        api,
        {
          reference: reference.trim(),
          name: name.trim(),
          ...(description ? { description } : {}),
        },
        controller.signal,
      )
      if (!controller.signal.aborted)
        navigate(`/samples/${encodeURIComponent(sample.id)}`, { replace: true })
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught)) {
        setError(
          caught instanceof ApiError ? caught.message : 'La création a échoué.',
        )
        setDetails(caught instanceof ApiError ? caught.details : [])
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <section className="page">
      <Link className="back-link" to="/samples">
        ← Tous les échantillons
      </Link>
      <div className="page-heading">
        <div>
          <h1>Créer un échantillon</h1>
          <p className="muted">
            Vous deviendrez propriétaire de cet échantillon.
          </p>
        </div>
      </div>
      <form
        className="sample-panel sample-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        aria-busy={busy}
      >
        <p>Les champs marqués * sont obligatoires.</p>
        {error && (
          <div className="alert" role="alert">
            <p>{error}</p>
            {details.length > 0 && (
              <ul>
                {details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="reference">Référence *</label>
          <input
            id="reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
            disabled={busy}
            aria-describedby="reference-help"
          />
          <p id="reference-help" className="muted">
            Une référence unique, par exemple K24-017.
          </p>
        </div>
        <div className="field">
          <label htmlFor="sample-name">Nom *</label>
          <input
            id="sample-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            disabled={busy}
          />
        </div>
        <div className="form-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer l’échantillon'}
          </button>
          <Link className="button button-secondary" to="/samples">
            Annuler
          </Link>
        </div>
        {busy && <p role="status">Enregistrement en cours…</p>}
      </form>
    </section>
  )
}
