import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { entryLabel, normalizedEntryValues } from './entry-format'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import { useSampleQuery } from '../samples/useSampleQuery'
import { createStep, getStepTypes, parameterValues } from './api'
import type { CreateStep } from './api'
import { OperatorSelect } from './OperatorSelect'

export function StepForm({
  sampleId,
  sampleReference,
  sampleName,
  onCreated,
  onCancel,
  actionsHost,
  onDirty,
  onBusy,
}: {
  sampleId: string
  sampleReference: string
  sampleName: string
  onCreated: () => void
  onCancel: () => void
  actionsHost?: HTMLElement | null
  onDirty?: () => void
  onBusy?: (busy: boolean) => void
}) {
  const { api, user } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => getStepTypes(api, signal),
    [api],
  )
  const catalogue = useSampleQuery(load)
  const [typeId, setTypeId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [performedAt, setPerformedAt] = useState(() => {
    const now = new Date()
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19)
  })
  const [result, setResult] = useState<CreateStep['result'] | ''>('')
  const [operatorId, setOperatorId] = useState(user?.id ?? '')
  const [observations, setObservations] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => onBusy?.(busy), [busy, onBusy])
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (!error) return
    const form = document.getElementById('new-step-form')
    const target = form?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(fieldset), [role="alert"]',
    )
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
  }, [error, fieldErrors])
  const types = catalogue.data?.filter((type) => type.isActive)
  const type = types?.find((item) => item.id === typeId)

  async function submit() {
    if (pending.current) return
    setError(null)
    setDetails([])
    const normalized = type ? normalizedEntryValues(type, values) : values
    const invalid: Record<string, string> = {}
    if (!type) invalid.type = 'Choisissez un type d’opération.'
    if (!result) invalid.result = 'Choisissez un résultat.'
    if (!performedAt || !Number.isFinite(new Date(performedAt).getTime()))
      invalid.date = 'Indiquez une date de réalisation valide.'
    if (type) {
      for (const definition of type.parameters) {
        try {
          parameterValues({ ...type, parameters: [definition] }, normalized)
        } catch (caught) {
          invalid[definition.id] = (caught as Error).message
        }
      }
    }
    setFieldErrors(invalid)
    if (Object.keys(invalid).length || !type || !result) {
      setError(
        Object.values(invalid)[0] ??
          'Veuillez vérifier les champs du formulaire.',
      )
      return
    }
    const parameters = parameterValues(type, normalized)
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      await createStep(
        api,
        sampleId,
        {
          stepTypeId: type.id,
          performedAt: new Date(performedAt).toISOString(),
          result,
          parameterValues: parameters,
          ...(operatorId.trim() ? { operatorId: operatorId.trim() } : {}),
          ...(observations ? { observations } : {}),
        },
        controller.signal,
      )
      if (!controller.signal.aborted) onCreated()
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught)) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'L’enregistrement a échoué.',
        )
        setDetails(caught instanceof ApiError ? caught.details : [])
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const actions = (
    <div className="entry-actions">
      <button
        type="submit"
        form="new-step-form"
        className="button button-primary"
        disabled={busy}
      >
        {busy ? 'Enregistrement…' : 'Enregistrer l’étape'}
      </button>
      <button
        type="button"
        className="button button-secondary"
        onClick={onCancel}
        disabled={busy}
      >
        Annuler la saisie
      </button>
    </div>
  )

  return (
    <section
      className="fabrication-section step-entry"
      aria-labelledby="step-form-title"
    >
      <p className="muted step-entry-context">
        {sampleReference} · {sampleName}
      </p>
      {catalogue.loading && (
        <p role="status">Chargement des types d’opérations…</p>
      )}
      {catalogue.error && (
        <div>
          <p role="alert" className="alert">
            {catalogue.error}
          </p>
          <button className="button button-secondary" onClick={catalogue.retry}>
            Réessayer le catalogue
          </button>
        </div>
      )}
      {types?.length === 0 && (
        <p role="status">
          Aucun type d’opération actif. Contactez la responsable du catalogue.
        </p>
      )}
      {types && types.length > 0 && (
        <form
          id="new-step-form"
          onChangeCapture={onDirty}
          className="sample-panel sample-form"
          aria-busy={busy}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error && (
            <div role="alert" tabIndex={-1} className="alert">
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
            <label htmlFor="step-type">Type d’opération *</label>
            <select
              id="step-type"
              value={typeId}
              required
              disabled={busy}
              aria-invalid={!!fieldErrors.type}
              aria-describedby={fieldErrors.type ? 'type-error' : undefined}
              onChange={(event) => {
                setTypeId(event.target.value)
                setError(null)
                setDetails([])
                setFieldErrors({})
              }}
            >
              <option value="">Choisir un type</option>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {type?.description && <p className="muted">{type.description}</p>}
            {fieldErrors.type && (
              <p className="entry-field-error" id="type-error">
                {fieldErrors.type}
              </p>
            )}
          </div>
          {type && (
            <fieldset disabled={busy} className="parameter-fields">
              <legend>Paramètres de l’opération</legend>
              {type.parameters.length === 0 && (
                <p>Aucun paramètre défini pour ce type.</p>
              )}
              {type.parameters.map((definition) => {
                const id = `parameter-${definition.id}`
                const label = entryLabel(definition)
                return (
                  <div
                    className={`field ${definition.dataType === 'TEXT' ? 'parameter-long' : ''}`}
                    key={definition.id}
                  >
                    <label htmlFor={id}>{label}</label>
                    {definition.dataType === 'BOOLEAN' ? (
                      <select
                        id={id}
                        required={definition.isRequired}
                        aria-invalid={!!fieldErrors[definition.id]}
                        aria-describedby={
                          fieldErrors[definition.id] ? `${id}-error` : undefined
                        }
                        value={values[definition.id] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [definition.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Non renseigné</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    ) : (
                      <div className="entry-unit-field">
                        <input
                          id={id}
                          type="text"
                          inputMode={
                            definition.dataType === 'NUMBER'
                              ? 'decimal'
                              : 'text'
                          }
                          required={
                            definition.isRequired &&
                            definition.dataType !== 'TEXT'
                          }
                          aria-invalid={!!fieldErrors[definition.id]}
                          value={values[definition.id] ?? ''}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [definition.id]: event.target.value,
                            }))
                          }
                          aria-describedby={
                            [
                              definition.dataType === 'NUMBER'
                                ? `${id}-help`
                                : '',
                              fieldErrors[definition.id] ? `${id}-error` : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                        />
                        {definition.unit && (
                          <span aria-hidden="true" className="entry-unit">
                            {definition.unit}
                          </span>
                        )}
                      </div>
                    )}
                    {definition.dataType === 'NUMBER' && (
                      <p className="muted" id={`${id}-help`}>
                        Décimal avec une virgule ou un point, sans exposant.
                        Exemple : 0,125
                      </p>
                    )}
                    {fieldErrors[definition.id] && (
                      <p className="entry-field-error" id={`${id}-error`}>
                        {fieldErrors[definition.id]}
                      </p>
                    )}
                  </div>
                )
              })}
            </fieldset>
          )}
          <fieldset
            className="step-result-options"
            disabled={busy}
            aria-describedby={fieldErrors.result ? 'result-error' : undefined}
            aria-invalid={!!fieldErrors.result}
          >
            <legend>Résultat *</legend>
            <div className="step-result-choices">
              <label>
                <input
                  type="radio"
                  name="step-result"
                  value="SUCCESS"
                  checked={result === 'SUCCESS'}
                  required
                  onChange={() => setResult('SUCCESS')}
                />{' '}
                Réussie
              </label>
              <label>
                <input
                  type="radio"
                  name="step-result"
                  value="FAILURE"
                  checked={result === 'FAILURE'}
                  required
                  onChange={() => setResult('FAILURE')}
                />{' '}
                Échouée
              </label>
            </div>
            {fieldErrors.result && (
              <p className="entry-field-error" id="result-error">
                {fieldErrors.result}
              </p>
            )}
          </fieldset>
          <div className="field">
            <label htmlFor="step-observations">Observations</label>
            <textarea
              id="step-observations"
              placeholder="Ex. Épaisseur inférieure à la valeur cible"
              rows={3}
              value={observations}
              disabled={busy}
              onChange={(event) => setObservations(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="performed-at">Date de réalisation *</label>
            <input
              id="performed-at"
              type="datetime-local"
              step="1"
              required
              value={performedAt}
              disabled={busy}
              aria-invalid={!!fieldErrors.date}
              aria-describedby={fieldErrors.date ? 'date-error' : undefined}
              onChange={(event) => setPerformedAt(event.target.value)}
            />
            {fieldErrors.date && (
              <p className="entry-field-error" id="date-error">
                {fieldErrors.date}
              </p>
            )}
          </div>
          <OperatorSelect
            value={operatorId}
            onChange={setOperatorId}
            disabled={busy}
          />
          {actionsHost ? createPortal(actions, actionsHost) : actions}
          {busy && <p role="status">Enregistrement de l’étape en cours…</p>}
        </form>
      )}
      {(!types || types.length === 0) && (
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Annuler la saisie
        </button>
      )}
    </section>
  )
}
