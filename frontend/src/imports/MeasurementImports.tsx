import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import { ApiError } from '../api/client'
import { SidePanel } from '../components/SidePanel'
import { useSampleQuery } from '../samples/useSampleQuery'
import { formatDate } from '../samples/api'
import type { StepType, FabricationStep } from '../fabrication/api'
import './imports.css'

type ImportRecord = {
  id: string
  rowCount: number
  stepId: string | null
  createdAt: string
  sourceAttachment: { id: string; originalName: string }
  createdBy: { name: string }
  stepType: { name: string }
  values?: {
    id: string
    rowNumber: number
    numericValue: string | null
    textValue: string | null
    booleanValue: boolean | null
    definition: { name: string; unit: string | null }
  }[]
}
type Mapping = { column: number; definitionId: string; unit: string | null }
type Preview = {
  rowCount: number
  validRowCount: number
  errorCount: number
  errors: {
    row: number
    line: number
    column: string | null
    message: string
  }[]
  rows: { row: number; line: number; cells: string[] }[]
  headers: string[]
  duplicate: boolean
  canConfirm: boolean
  previewToken: string | null
}
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? [error.message, ...error.details].join(' ')
    : error instanceof Error
      ? error.message
      : 'Impossible de traiter cet import.'

export function MeasurementImports({
  sampleId,
  authorized,
}: {
  sampleId: string
  authorized: boolean
}) {
  const [visible, setVisible] = useState(false),
    [editing, setEditing] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <section className="measurement-imports">
      <button
        className="button button-secondary"
        aria-expanded={visible}
        onClick={() => setVisible(!visible)}
      >
        Mesures importées
      </button>
      {authorized && (
        <button
          ref={opener}
          className="button button-secondary"
          onClick={() => {
            setVisible(true)
            setEditing(true)
          }}
        >
          Importer un CSV
        </button>
      )}
      {visible && (
        <ImportList key={`${sampleId}:${editing}`} sampleId={sampleId} />
      )}
      {editing && (
        <ImportWizard
          sampleId={sampleId}
          opener={opener}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  )
}
function ImportList({ sampleId }: { sampleId: string }) {
  const { api } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<ImportRecord[]>(`/samples/${sampleId}/imports`, { signal }),
    [api, sampleId],
  )
  const result = useSampleQuery(load)
  const [detail, setDetail] = useState<ImportRecord | null>(null),
    [error, setError] = useState('')
  async function show(id: string) {
    try {
      setError('')
      setDetail(
        await api.request<ImportRecord>(`/samples/${sampleId}/imports/${id}`),
      )
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="import-list">
      {result.loading && <p role="status">Chargement des imports…</p>}
      {(result.error || error) && <p role="alert">{result.error || error}</p>}
      {result.error && (
        <button className="button button-secondary" onClick={result.retry}>
          Réessayer les imports
        </button>
      )}
      {result.data?.length === 0 && <p>Aucune mesure importée.</p>}
      {result.data?.map((item) => (
        <article key={item.id}>
          <strong>{item.sourceAttachment.originalName}</strong>
          <p className="muted">
            {item.rowCount} ligne(s) · {item.stepType.name} ·{' '}
            {item.createdBy.name} · {formatDate(item.createdAt)}
            {item.stepId
              ? ' · Associé à une étape'
              : ' · Associé à l’échantillon'}
          </p>
          <button
            className="button button-secondary"
            onClick={() => void show(item.id)}
          >
            Consulter les mesures
          </button>
        </article>
      ))}
      {detail && (
        <div>
          <h4>{detail.sourceAttachment.originalName}</h4>
          <div className="import-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Paramètre</th>
                  <th>Valeur</th>
                </tr>
              </thead>
              <tbody>
                {detail.values?.map((value) => (
                  <tr key={value.id}>
                    <td>{value.rowNumber}</td>
                    <td>{value.definition.name}</td>
                    <td>
                      {value.numericValue !== null
                        ? value.numericValue.replace('.', ',')
                        : (value.textValue ??
                          (value.booleanValue ? 'Oui' : 'Non'))}
                      {value.definition.unit ? ` ${value.definition.unit}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="button button-secondary"
            onClick={() => setDetail(null)}
          >
            Masquer les mesures
          </button>
        </div>
      )}
    </div>
  )
}
function ImportWizard({
  sampleId,
  opener,
  onClose,
}: {
  sampleId: string
  opener: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { api } = useAuth()
  const [file, setFile] = useState<File | null>(null),
    [attachmentId, setAttachmentId] = useState('')
  const [delimiter, setDelimiter] = useState(';'),
    [decimalSeparator, setDecimal] = useState('.')
  const [types, setTypes] = useState<StepType[]>([]),
    [steps, setSteps] = useState<FabricationStep[]>([])
  const [sourceFiles, setSourceFiles] = useState<
    { id: string; originalName: string; mimeType: string }[]
  >([])
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [stepId, setStepId] = useState(''),
    [typeId, setTypeId] = useState(''),
    [headers, setHeaders] = useState<string[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false)
  const pending = useRef(false)
  const type = types.find((t) => t.id === typeId)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.request<StepType[]>('/step-types', { signal: controller.signal }),
      api.request<FabricationStep[]>(`/samples/${sampleId}/steps`, {
        signal: controller.signal,
      }),
      api.request<typeof sourceFiles>(`/samples/${sampleId}/files`, {
        signal: controller.signal,
      }),
    ]).then(
      ([catalogue, history, files]) => {
        if (!controller.signal.aborted) {
          setTypes(catalogue)
          setSteps(history)
          setSourceFiles(files.filter((f) => f.mimeType === 'text/csv'))
          setLoading(false)
        }
      },
      (caught) => {
        if (!controller.signal.aborted) {
          setError(errorText(caught))
          setLoading(false)
        }
      },
    )
    return () => controller.abort()
  }, [api, sampleId])
  const invalidate = () => {
    setPreview(null)
    setConfirmed(false)
  }
  const body = () => ({
    attachmentId,
    ...(stepId ? { stepId } : {}),
    stepTypeId: typeId,
    delimiter,
    decimalSeparator,
    mappings,
  })
  async function work(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(errorText(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  function inspect() {
    void work(async () => {
      invalidate()
      let id = attachmentId
      if (file && !id) {
        const data = new FormData()
        data.append('file', file)
        id = (
          await api.request<{ id: string }>(`/samples/${sampleId}/files`, {
            method: 'POST',
            body: data,
          })
        ).id
        setAttachmentId(id)
      }
      if (!id)
        throw new Error('Choisissez un CSV ou un fichier source déjà ajouté.')
      const data = await api.request<{ headers: string[] }>(
        `/samples/${sampleId}/imports/inspect`,
        { method: 'POST', body: { attachmentId: id, delimiter } },
      )
      setHeaders(data.headers)
      setMappings([])
    })
  }
  function verify() {
    void work(async () => {
      invalidate()
      if (!typeId || !mappings.length) {
        setError('Choisissez un type et associez au moins une colonne.')
        return
      }
      setPreview(
        await api.request<Preview>(`/samples/${sampleId}/imports/preview`, {
          method: 'POST',
          body: body(),
        }),
      )
    })
  }
  function save() {
    void work(async () => {
      if (!confirmed || !preview?.canConfirm || !preview.previewToken) {
        setError('Prévisualisez puis confirmez explicitement l’import.')
        return
      }
      await api.request(`/samples/${sampleId}/imports`, {
        method: 'POST',
        body: {
          ...body(),
          confirmed: true,
          previewToken: preview.previewToken,
        },
      })
      onClose()
    })
  }
  return (
    <SidePanel
      id="csv-import-panel"
      title="Importer des mesures CSV"
      openerRef={opener}
      busy={busy}
      dirty={!!file || !!attachmentId}
      onClose={onClose}
      footer={(close) => (
        <>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={close}
          >
            Annuler
          </button>
          <button
            className="button button-primary"
            disabled={busy || !confirmed || !preview?.canConfirm}
            onClick={save}
          >
            {busy ? 'Traitement…' : 'Enregistrer les mesures'}
          </button>
        </>
      )}
    >
      {() => (
        <div className="csv-wizard">
          <p className="muted">
            Les mesures sont conservées séparément : aucun paramètre d’étape
            existant ne sera remplacé. Le fichier source reste une pièce jointe,
            même si l’import n’est pas confirmé.
          </p>
          {loading && <p role="status">Chargement du catalogue…</p>}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy || loading}>
            <div className="field">
              <label htmlFor="csv-file">Fichier CSV UTF-8</label>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setAttachmentId('')
                  setHeaders([])
                  invalidate()
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="csv-existing">
                Ou choisir un CSV déjà ajouté
              </label>
              <select
                id="csv-existing"
                value={file ? '' : attachmentId}
                onChange={(e) => {
                  setFile(null)
                  setAttachmentId(e.target.value)
                  setHeaders([])
                  invalidate()
                }}
              >
                <option value="">Choisir un fichier source</option>
                {sourceFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.originalName}
                  </option>
                ))}
              </select>
            </div>
            <div className="import-options">
              <div className="field">
                <label htmlFor="csv-delimiter">Séparateur de colonnes</label>
                <select
                  id="csv-delimiter"
                  value={delimiter}
                  onChange={(e) => {
                    setDelimiter(e.target.value)
                    setHeaders([])
                    invalidate()
                  }}
                >
                  <option value=";">Point-virgule ;</option>
                  <option value=",">Virgule ,</option>
                  <option value={'\t'}>Tabulation</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="csv-decimal">Séparateur décimal</label>
                <select
                  id="csv-decimal"
                  value={decimalSeparator}
                  onChange={(e) => {
                    setDecimal(e.target.value)
                    invalidate()
                  }}
                >
                  <option value=".">Point .</option>
                  <option value=",">Virgule ,</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={inspect}
            >
              Lire les colonnes
            </button>
            <div className="field">
              <label htmlFor="csv-step">
                Association à une étape (facultatif)
              </label>
              <select
                id="csv-step"
                value={stepId}
                onChange={(e) => {
                  setStepId(e.target.value)
                  const selected = steps.find((s) => s.id === e.target.value)
                  setTypeId(selected?.stepType?.id ?? '')
                  setMappings([])
                  invalidate()
                }}
              >
                <option value="">Échantillon uniquement</option>
                {steps
                  .filter(
                    (s) =>
                      s.stepType && types.some((t) => t.id === s.stepType!.id),
                  )
                  .map((s, i) => (
                    <option key={s.id} value={s.id}>
                      Étape {i + 1} · {s.operationName} ·{' '}
                      {formatDate(s.performedAt)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="csv-type">Type de paramètres du catalogue</label>
              <select
                id="csv-type"
                value={typeId}
                disabled={!!stepId}
                onChange={(e) => {
                  setTypeId(e.target.value)
                  setMappings([])
                  invalidate()
                }}
              >
                <option value="">Choisir un type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {headers.length > 0 && (
              <>
                <h3>Correspondance des colonnes</h3>
                <p className="muted">
                  Déclarez les unités du fichier : elles doivent être identiques
                  à celles du catalogue. Aucune conversion automatique. Booléens
                  : true, false, 1 ou 0.
                </p>
                {headers.map((header, column) => {
                  const mapping = mappings.find((m) => m.column === column)
                  return (
                    <div className="import-mapping" key={column}>
                      <div className="field">
                        <label htmlFor={`csv-map-${column}`}>{header}</label>
                        <select
                          id={`csv-map-${column}`}
                          value={mapping?.definitionId ?? ''}
                          onChange={(e) => {
                            const definition = type?.parameters.find(
                              (d) => d.id === e.target.value,
                            )
                            setMappings((current) => [
                              ...current.filter((m) => m.column !== column),
                              ...(definition
                                ? [
                                    {
                                      column,
                                      definitionId: definition.id,
                                      unit: definition.unit,
                                    },
                                  ]
                                : []),
                            ])
                            invalidate()
                          }}
                        >
                          <option value="">
                            Ne pas importer cette colonne
                          </option>
                          {type?.parameters.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} · {d.dataType}
                              {d.unit ? ` (${d.unit})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      {mapping && (
                        <div className="field">
                          <label htmlFor={`csv-unit-${column}`}>
                            Unité source — {header}
                          </label>
                          <input
                            id={`csv-unit-${column}`}
                            value={mapping.unit ?? ''}
                            placeholder="Sans unité"
                            onChange={(e) => {
                              setMappings((current) =>
                                current.map((m) =>
                                  m.column === column
                                    ? { ...m, unit: e.target.value || null }
                                    : m,
                                ),
                              )
                              invalidate()
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={verify}
                >
                  Prévisualiser et vérifier
                </button>
              </>
            )}
          </fieldset>
          {preview && (
            <div aria-live="polite">
              <h3>Prévisualisation</h3>
              <p>
                {preview.validRowCount} ligne(s) valide(s) sur{' '}
                {preview.rowCount}.
              </p>
              {preview.duplicate && (
                <p role="alert" className="alert">
                  Ce fichier a déjà été importé pour cette association.
                </p>
              )}
              {preview.errors.length > 0 && (
                <div role="alert">
                  <p>
                    {preview.errorCount} erreur(s) : aucun enregistrement
                    possible.
                  </p>
                  <ul>
                    {preview.errors.map((e, i) => (
                      <li key={i}>
                        Ligne CSV {e.line}
                        {e.column ? ` · ${e.column}` : ''} : {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="muted">
                Aperçu des {preview.rows.length} premières lignes ; toutes les
                lignes sont vérifiées.
              </p>
              <div className="import-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ligne CSV</th>
                      {preview.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.row}>
                        <td>{row.line}</td>
                        {row.cells.map((cell, i) => (
                          <td key={i}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.canConfirm && (
                <label className="import-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Je confirme la correspondance des colonnes, les unités et
                  l’enregistrement de ces mesures.
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </SidePanel>
  )
}
