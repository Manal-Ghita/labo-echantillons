import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import { formatDate } from '../samples/api'
import { useSampleQuery } from '../samples/useSampleQuery'
import { parameterValues } from './api'
import type { FabricationStep, StepType } from './api'
import './corrections.css'
import { numericDisplay, resultDisplay } from './display'

type Snapshot = Partial<
  Pick<
    FabricationStep,
    | 'performedAt'
    | 'result'
    | 'observations'
    | 'parameters'
    | 'operator'
    | 'parameterValues'
  >
>
type Correction = {
  id: string
  revision: number
  reason: string
  correctedAt: string
  correctedBy: { id: string; name: string }
  beforeSnapshot: Snapshot
  afterSnapshot: Snapshot
}
function SnapshotView({ value }: { value: Snapshot }) {
  return (
    <div>
      <p>
        Réalisation :{' '}
        {value.performedAt ? formatDate(value.performedAt) : 'Non renseignée'}
      </p>
      <p>Résultat : {resultDisplay(value.result)}</p>
      {value.operator && <p>Opérateur : {value.operator.name}</p>}
      <p className="sample-description">
        Observations : {value.observations ?? 'Aucune'}
      </p>
      {value.parameters !== null && value.parameters !== undefined && (
        <p className="sample-description">
          Paramètres textuels : {value.parameters}
        </p>
      )}
      <dl className="sample-facts">
        {value.parameterValues?.map((parameter) => (
          <div key={parameter.definition.id}>
            <dt>
              {parameter.definition.name}
              {parameter.definition.unit
                ? ` (${parameter.definition.unit})`
                : ''}
            </dt>
            <dd className="parameter-value">
              {(parameter.numericValue !== null
                ? numericDisplay(
                    parameter.numericValue,
                    parameter.definition.unit,
                  )
                : null) ??
                parameter.textValue ??
                (parameter.booleanValue === null
                  ? 'Non renseigné'
                  : parameter.booleanValue
                    ? 'Oui'
                    : 'Non')}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
function CorrectionHistory({ url }: { url: string }) {
  const { api } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => api.request<Correction[]>(url, { signal }),
    [api, url],
  )
  const history = useSampleQuery(load)
  return (
    <section aria-label="Journal des corrections">
      <h4>Journal des corrections</h4>
      {history.loading && <p role="status">Chargement des corrections…</p>}
      {history.error && (
        <>
          <p className="alert" role="alert">
            {history.error}
          </p>
          <button className="button button-secondary" onClick={history.retry}>
            Réessayer les corrections
          </button>
        </>
      )}
      {history.data?.length === 0 && <p>Aucune correction enregistrée.</p>}
      <ol>
        {history.data?.map((correction) => (
          <li key={correction.id}>
            <p>
              <strong>Révision {correction.revision}</strong> —{' '}
              {correction.correctedBy.name} —{' '}
              <time dateTime={correction.correctedAt}>
                {formatDate(correction.correctedAt)}
              </time>
            </p>
            <p className="sample-description">Motif : {correction.reason}</p>
            <details>
              <summary>Voir les valeurs avant et après</summary>
              <h5>Avant</h5>
              <SnapshotView value={correction.beforeSnapshot} />
              <h5>Après</h5>
              <SnapshotView value={correction.afterSnapshot} />
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}
function localDate(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1)
}

function CorrectionForm({
  step,
  url,
  onSaved,
  onCancel,
}: {
  step: FabricationStep
  url: string
  onSaved: () => void
  onCancel: () => void
}) {
  const { api } = useAuth()
  const definitions =
    step.stepType?.parameters ??
    step.parameterValues.map((value) => value.definition)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      step.parameterValues.map((value) => [
        value.definition.id,
        value.numericValue ??
          value.textValue ??
          (value.booleanValue === null ? '' : String(value.booleanValue)),
      ]),
    ),
  )
  const [reason, setReason] = useState('')
  const [performedAt, setPerformedAt] = useState(() =>
    localDate(step.performedAt),
  )
  const [result, setResult] = useState(step.result ?? '')
  const [operatorId, setOperatorId] = useState(step.operator?.id ?? '')
  const [observations, setObservations] = useState(step.observations ?? '')
  const [legacy, setLegacy] = useState(step.parameters ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit() {
    if (pending.current) return
    setError(null)
    if (
      !reason.trim() ||
      !performedAt ||
      !Number.isFinite(new Date(performedAt).getTime())
    ) {
      setError('Un motif et une date valides sont obligatoires.')
      return
    }
    let structured
    try {
      if (step.stepType)
        structured = parameterValues(
          {
            ...step.stepType,
            description: null,
            parameters: definitions,
          } as StepType,
          values,
        )
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      await api.request<FabricationStep>(url, {
        method: 'POST',
        signal: controller.signal,
        body: {
          expectedRevision: step.revision ?? 0,
          reason: reason.trim(),
          performedAt: new Date(performedAt).toISOString(),
          ...(result ? { result } : {}),
          operatorId: operatorId.trim() || null,
          observations: observations || null,
          ...(step.parameters !== null ? { parameters: legacy } : {}),
          ...(structured ? { parameterValues: structured } : {}),
        },
      })
      if (!controller.signal.aborted) onSaved()
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? [caught.message, ...caught.details].join(' ')
            : 'Correction impossible.',
        )
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const prefix = `correction-${step.id}`
  return (
    <form
      className="sample-form"
      aria-label={`Corriger ${step.operationName}`}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      aria-busy={busy}
    >
      <p>
        Le code de l’opération et l’auteur initial sont conservés. Toutes les
        valeurs précédentes seront gardées dans le journal.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${prefix}-reason`}>Motif de correction *</label>
        <textarea
          id={`${prefix}-reason`}
          required
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-date`}>Réalisation corrigée *</label>
        <input
          id={`${prefix}-date`}
          type="datetime-local"
          step="0.001"
          required
          value={performedAt}
          disabled={busy}
          onChange={(event) => setPerformedAt(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-result`}>Résultat corrigé</label>
        <select
          id={`${prefix}-result`}
          value={result}
          disabled={busy}
          onChange={(event) => setResult(event.target.value as typeof result)}
        >
          {step.result === null && <option value="">Non renseigné</option>}
          <option value="SUCCESS">Réussie</option>
          <option value="FAILURE">Échouée</option>
        </select>
      </div>
      <fieldset className="parameter-fields" disabled={busy}>
        <legend>Valeurs corrigées</legend>
        {definitions.map((definition) => (
          <div className="field" key={definition.id}>
            <label htmlFor={`${prefix}-${definition.id}`}>
              {definition.name}
              {definition.unit ? ` (${definition.unit})` : ''}
              {definition.isRequired ? ' *' : ''}
            </label>
            {definition.dataType === 'BOOLEAN' ? (
              <select
                id={`${prefix}-${definition.id}`}
                required={definition.isRequired}
                value={values[definition.id] ?? ''}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [definition.id]: event.target.value,
                  }))
                }
              >
                <option value="">Non renseigné</option>
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            ) : (
              <input
                id={`${prefix}-${definition.id}`}
                type="text"
                inputMode={
                  definition.dataType === 'NUMBER' ? 'decimal' : 'text'
                }
                required={
                  definition.isRequired && definition.dataType === 'NUMBER'
                }
                value={values[definition.id] ?? ''}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [definition.id]: event.target.value,
                  }))
                }
              />
            )}
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${prefix}-operator`}>Opérateur corrigé (UUID)</label>
        <input
          id={`${prefix}-operator`}
          value={operatorId}
          disabled={busy}
          pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          onChange={(event) => setOperatorId(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-observations`}>Observations corrigées</label>
        <textarea
          id={`${prefix}-observations`}
          value={observations}
          disabled={busy}
          onChange={(event) => setObservations(event.target.value)}
        />
      </div>
      {step.parameters !== null && (
        <div className="field">
          <label htmlFor={`${prefix}-legacy`}>
            Paramètres textuels corrigés
          </label>
          <textarea
            id={`${prefix}-legacy`}
            value={legacy}
            disabled={busy}
            onChange={(event) => setLegacy(event.target.value)}
          />
        </div>
      )}
      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? 'Correction…' : 'Confirmer la correction'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler la correction
        </button>
      </div>
    </form>
  )
}

export function StepCorrections({
  step,
  sampleId,
  authorized,
  onUpdated,
}: {
  step: FabricationStep
  sampleId: string
  authorized: boolean
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  // Each committed correction increments revision and creates one audit record atomically.
  const corrections =
    typeof step.revision === 'number' &&
    Number.isSafeInteger(step.revision) &&
    step.revision > 0
      ? step.revision
      : 0
  const url = `/samples/${encodeURIComponent(sampleId)}/steps/${encodeURIComponent(step.id)}/corrections`
  return (
    <div className="step-corrections">
      <div className="form-actions">
        {authorized && !editing && (
          <button
            className="button button-secondary"
            onClick={() => setEditing(true)}
          >
            Corriger l’étape
          </button>
        )}
        {corrections > 0 && (
          <button
            className="button button-secondary"
            onClick={() => setHistory((value) => !value)}
            aria-expanded={history}
          >
            {history ? 'Masquer les corrections' : 'Afficher les corrections'} (
            {corrections} {corrections === 1 ? 'correction' : 'corrections'})
          </button>
        )}
      </div>
      {editing && authorized && (
        <CorrectionForm
          step={step}
          url={url}
          onCancel={() => setEditing(false)}
          onSaved={onUpdated}
        />
      )}
      {history && <CorrectionHistory url={url} />}
    </div>
  )
}
