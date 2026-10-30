import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/context'
import { useSampleQuery } from '../samples/useSampleQuery'
import { formatDate, sampleStatus } from '../samples/api'
import type { Sample } from '../samples/api'
import { SidePanel } from '../components/SidePanel'
import { StepForm } from '../fabrication/StepForm'
import type { CreateStep } from '../fabrication/api'
import './batches.css'

type Batch = {
  id: string
  reference: string
  createdById: string
  createdAt: string
  createdBy: { id: string; name: string }
  _count?: { samples: number }
  samples?: Sample[]
}

export function BatchesPage() {
  const { api } = useAuth()
  const navigate = useNavigate()
  const load = useCallback(
    (signal: AbortSignal) => api.request<Batch[]>('/batches', { signal }),
    [api],
  )
  const batches = useSampleQuery(load)
  const [adding, setAdding] = useState(false)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  async function create() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const batch = await api.request<Batch>('/batches', {
        method: 'POST',
        body: { reference: reference.trim() },
      })
      navigate(`/batches/${batch.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <section className="page batches-page">
      <div className="page-heading">
        <h1>Lots d’échantillons</h1>
        <button
          className="button button-primary"
          onClick={() => setAdding(true)}
        >
          Créer un lot
        </button>
      </div>
      {adding && (
        <form
          className="sample-panel batch-create"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="field">
            <label htmlFor="batch-reference">Référence du lot *</label>
            <input
              id="batch-reference"
              required
              value={reference}
              disabled={busy}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <div className="entry-actions">
            <button
              type="button"
              disabled={busy}
              className="button button-secondary"
              onClick={() => setAdding(false)}
            >
              Annuler
            </button>
            <button disabled={busy} className="button button-primary">
              {busy ? 'Création…' : 'Enregistrer le lot'}
            </button>
          </div>
        </form>
      )}
      {batches.loading && <p role="status">Chargement des lots…</p>}
      {batches.error && (
        <p role="alert" className="alert">
          {batches.error}
          <button onClick={batches.retry}>Réessayer</button>
        </p>
      )}
      {batches.data?.length === 0 && (
        <p className="sample-panel">Aucun lot enregistré.</p>
      )}
      {!!batches.data?.length && (
        <div
          className="batch-table-region"
          role="region"
          aria-label="Lots"
          tabIndex={0}
        >
          <table className="sample-table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Échantillons</th>
                <th>Créateur</th>
                <th>Création</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((batch) => (
                <tr key={batch.id}>
                  <th scope="row">
                    <Link to={`/batches/${batch.id}`}>{batch.reference}</Link>
                  </th>
                  <td>{batch._count?.samples ?? 0}</td>
                  <td>{batch.createdBy.name}</td>
                  <td>{formatDate(batch.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function BatchDetailPage() {
  const { id = '' } = useParams()
  const { api, user } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Batch>(`/batches/${encodeURIComponent(id)}`, { signal }),
    [api, id],
  )
  const detail = useSampleQuery(load)
  const loadSamples = useCallback(
    (signal: AbortSignal) => api.request<Sample[]>('/samples', { signal }),
    [api],
  )
  const candidates = useSampleQuery(loadSamples)
  const [selected, setSelected] = useState<string[]>([])
  const [attachIds, setAttachIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [entry, setEntry] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const pending = useRef(false)
  const owns = (sample: Sample) =>
    user?.role === 'ADMIN' || user?.id === sample.creatorId
  const batch = detail.data
  const canManage =
    batch && (user?.role === 'ADMIN' || user?.id === batch.createdById)
  const available = candidates.data?.filter(
    (s) =>
      !s.batchId &&
      owns(s) &&
      `${s.reference} ${s.name}`
        .toLocaleLowerCase('fr')
        .includes(query.toLocaleLowerCase('fr')),
  )
  const eligible =
    batch?.samples?.filter(
      (s) => selected.includes(s.id) && owns(s) && s.status !== 'ABANDONED',
    ) ?? []
  async function attach() {
    if (!attachIds.length || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.request(`/batches/${encodeURIComponent(id)}/samples`, {
        method: 'POST',
        body: { sampleIds: attachIds },
      })
      setAttachIds([])
      detail.retry()
      candidates.retry()
      setNotice('Échantillons associés au lot.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Association impossible.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <section className="page batches-page">
      <Link to="/batches" className="back-link">
        ← Tous les lots
      </Link>
      {detail.loading && <p role="status">Chargement du lot…</p>}
      {detail.error && (
        <p role="alert" className="alert">
          {detail.error}
          <button onClick={detail.retry}>Réessayer</button>
        </p>
      )}
      {batch && (
        <>
          <div className="page-heading">
            <div>
              <h1>{batch.reference}</h1>
              <p className="muted">
                Créé par {batch.createdBy.name} · {formatDate(batch.createdAt)}
              </p>
            </div>
            <button
              ref={opener}
              className="button button-primary"
              disabled={!eligible.length || busy}
              onClick={() => {
                setNotice('')
                setEntry(true)
              }}
            >
              Enregistrer une opération groupée
            </button>
          </div>
          {notice && (
            <p role="status" className="success-notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <p className="muted">
            Sélectionnez vos échantillons actifs. Chaque réalisation et chaque
            correction restent individuelles. Maximum 100 échantillons par
            saisie.
          </p>
          {!batch.samples?.length ? (
            <p className="sample-panel">
              Ce lot ne contient aucun échantillon.
            </p>
          ) : (
            <div
              className="batch-table-region"
              role="region"
              aria-label="Échantillons du lot"
              tabIndex={0}
            >
              <table className="sample-table">
                <thead>
                  <tr>
                    <th>Sélection</th>
                    <th>Référence</th>
                    <th>Nom</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.samples.map((sample) => (
                    <tr key={sample.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${sample.reference}`}
                          disabled={
                            !owns(sample) ||
                            sample.status === 'ABANDONED' ||
                            busy
                          }
                          checked={selected.includes(sample.id)}
                          onChange={(e) =>
                            setSelected((values) =>
                              e.target.checked
                                ? [...values, sample.id]
                                : values.filter((value) => value !== sample.id),
                            )
                          }
                        />
                      </td>
                      <th scope="row">
                        <Link to={`/samples/${sample.id}`}>
                          {sample.reference}
                        </Link>
                      </th>
                      <td>{sample.name}</td>
                      <td>{sampleStatus(sample.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canManage && (
            <section
              className="sample-panel batch-attach"
              aria-labelledby="attach-title"
            >
              <h2 id="attach-title">Associer des échantillons</h2>
              <p className="muted">
                Seuls les échantillons autorisés sans lot sont proposés. Aucun
                déplacement automatique entre lots.
              </p>
              <div className="field">
                <label htmlFor="batch-sample-search">Référence ou nom</label>
                <input
                  id="batch-sample-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {candidates.loading && (
                <p role="status">Chargement des échantillons…</p>
              )}
              {candidates.error && (
                <p role="alert">
                  {candidates.error}
                  <button onClick={candidates.retry}>
                    Réessayer les échantillons
                  </button>
                </p>
              )}
              {available?.length === 0 && <p>Aucun échantillon disponible.</p>}
              <div className="batch-candidates">
                {available?.map((sample) => (
                  <label key={sample.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={attachIds.includes(sample.id)}
                      onChange={(e) =>
                        setAttachIds((values) =>
                          e.target.checked
                            ? [...values, sample.id]
                            : values.filter((value) => value !== sample.id),
                        )
                      }
                    />{' '}
                    {sample.reference} · {sample.name}
                  </label>
                ))}
              </div>
              <button
                className="button button-secondary"
                disabled={!attachIds.length || busy}
                onClick={() => void attach()}
              >
                {busy ? 'Association…' : 'Associer au lot'}
              </button>
            </section>
          )}
          {entry && (
            <BatchStepPanel
              batch={batch}
              samples={eligible}
              openerRef={opener}
              onClose={() => setEntry(false)}
              onSaved={() => {
                setEntry(false)
                setSelected([])
                detail.retry()
                setNotice(
                  'Opérations enregistrées pour tous les échantillons sélectionnés.',
                )
              }}
            />
          )}
        </>
      )}
    </section>
  )
}

function BatchStepPanel({
  batch,
  samples,
  openerRef,
  onClose,
  onSaved,
}: {
  batch: Batch
  samples: Sample[]
  openerRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSaved: () => void
}) {
  const { api } = useAuth()
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const [results, setResults] = useState<
    Record<string, CreateStep['result'] | ''>
  >({})
  const markDirty = useCallback(() => setDirty(true), [])
  async function submit(operation: CreateStep, signal: AbortSignal) {
    return api.request(`/batches/${encodeURIComponent(batch.id)}/steps`, {
      method: 'POST',
      signal,
      body: {
        operation,
        samples: samples.map((s) => ({
          sampleId: s.id,
          result: results[s.id] || operation.result,
        })),
      },
    })
  }
  return (
    <SidePanel
      id="batch-step-panel"
      title="Opération groupée"
      openerRef={openerRef}
      busy={busy}
      dirty={dirty}
      onClose={onClose}
      footer={() => <div ref={setFooter} />}
    >
      {(close) => (
        <StepForm
          sampleId=""
          sampleReference={batch.reference}
          sampleName={`${samples.length} échantillon(s)`}
          onCreated={onSaved}
          onCancel={close}
          actionsHost={footer}
          onDirty={markDirty}
          onBusy={setBusy}
          submitStep={submit}
          submitLabel="Enregistrer pour la sélection"
          resultDetails={
            <fieldset className="parameter-fields" disabled={busy}>
              <legend>Résultats individuels</legend>
              <p>
                Le résultat commun est utilisé sauf choix individuel ci-dessous.
              </p>
              {samples.map((s) => (
                <div className="field" key={s.id}>
                  <label htmlFor={`batch-result-${s.id}`}>
                    Résultat pour {s.reference}
                  </label>
                  <select
                    id={`batch-result-${s.id}`}
                    value={results[s.id] ?? ''}
                    onChange={(e) =>
                      setResults((current) => ({
                        ...current,
                        [s.id]: e.target.value as CreateStep['result'] | '',
                      }))
                    }
                  >
                    <option value="">Résultat commun</option>
                    <option value="SUCCESS">Réussie</option>
                    <option value="FAILURE">Échouée</option>
                  </select>
                </div>
              ))}
            </fieldset>
          }
        />
      )}
    </SidePanel>
  )
}
