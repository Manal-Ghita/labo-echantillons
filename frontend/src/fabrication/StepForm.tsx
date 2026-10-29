import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import { useSampleQuery } from '../samples/useSampleQuery'
import { createStep, getStepTypes, parameterValues } from './api'
import type { CreateStep } from './api'

export function StepForm({
  sampleId,
  onCreated,
  onCancel,
}: {
  sampleId: string
  onCreated: () => void
  onCancel: () => void
}) {
  const { api } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => getStepTypes(api, signal),
    [api],
  )
  const catalogue = useSampleQuery(load)
  const [typeId, setTypeId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [performedAt, setPerformedAt] = useState('')
  const [result, setResult] = useState<CreateStep['result'] | ''>('')
  const [operatorId, setOperatorId] = useState('')
  const [observations, setObservations] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const types = catalogue.data?.filter((type) => type.isActive)
  const type = types?.find((item) => item.id === typeId)

  async function submit() {
    if (pending.current) return
    setError(null)
    setDetails([])
    if (
      !type ||
      !result ||
      !performedAt ||
      !Number.isFinite(new Date(performedAt).getTime())
    ) {
      setError(
        'Le type, la date de réalisation et le résultat sont obligatoires.',
      )
      return
    }
    let parameters: CreateStep['parameterValues']
    try {
      parameters = parameterValues(type, values)
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
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

  return (
    <section className="fabrication-section" aria-labelledby="step-form-title">
      <h2 id="step-form-title">Nouvelle étape de fabrication</h2>
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
          className="sample-panel sample-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <p>
            Les champs marqués * sont obligatoires. La date est saisie dans
            votre heure locale.
          </p>
          {error && (
            <div role="alert" className="alert">
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
              onChange={(event) => {
                setTypeId(event.target.value)
                setValues({})
                setError(null)
                setDetails([])
              }}
            >
              <option value="">Choisir un type</option>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
            {type?.description && <p className="muted">{type.description}</p>}
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
              onChange={(event) => setPerformedAt(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="step-result">Résultat *</label>
            <select
              id="step-result"
              required
              value={result}
              disabled={busy}
              onChange={(event) =>
                setResult(event.target.value as typeof result)
              }
            >
              <option value="">Choisir un résultat</option>
              <option value="SUCCESS">Réussie (SUCCESS)</option>
              <option value="FAILURE">Échouée (FAILURE)</option>
            </select>
          </div>
          {type && (
            <fieldset disabled={busy} className="parameter-fields">
              <legend>Paramètres de l’opération</legend>
              {type.parameters.length === 0 && (
                <p>Aucun paramètre défini pour ce type.</p>
              )}
              {type.parameters.map((definition) => {
                const id = `parameter-${definition.id}`
                const label = `${definition.name}${definition.unit ? ` (${definition.unit})` : ''}${definition.isRequired ? ' *' : ''}`
                return (
                  <div className="field" key={definition.id}>
                    <label htmlFor={id}>{label}</label>
                    {definition.dataType === 'BOOLEAN' ? (
                      <select
                        id={id}
                        required={definition.isRequired}
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
                      <input
                        id={id}
                        type="text"
                        inputMode={
                          definition.dataType === 'NUMBER' ? 'decimal' : 'text'
                        }
                        required={
                          definition.isRequired &&
                          definition.dataType !== 'TEXT'
                        }
                        value={values[definition.id] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [definition.id]: event.target.value,
                          }))
                        }
                        aria-describedby={
                          definition.dataType === 'NUMBER'
                            ? `${id}-help`
                            : undefined
                        }
                      />
                    )}
                    {definition.dataType === 'NUMBER' && (
                      <p className="muted" id={`${id}-help`}>
                        Décimal avec un point, sans exposant. Exemple : 0.125
                      </p>
                    )}
                  </div>
                )
              })}
            </fieldset>
          )}
          <div className="field">
            <label htmlFor="step-operator">
              Opérateur réel (UUID, facultatif)
            </label>
            <input
              id="step-operator"
              value={operatorId}
              disabled={busy}
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              onChange={(event) => setOperatorId(event.target.value)}
              aria-describedby="operator-help"
            />
            <p id="operator-help" className="muted">
              Identifiant d’un utilisateur existant. L’auteur de saisie est
              automatiquement votre compte connecté.
            </p>
          </div>
          <div className="field">
            <label htmlFor="step-observations">Observations</label>
            <textarea
              id="step-observations"
              rows={4}
              value={observations}
              disabled={busy}
              onChange={(event) => setObservations(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !type}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer l’étape'}
          </button>
          {busy && <p role="status">Enregistrement de l’étape en cours…</p>}
        </form>
      )}
      <button
        type="button"
        className="button button-secondary cancel-step"
        onClick={onCancel}
        disabled={busy}
      >
        Annuler la saisie
      </button>
    </section>
  )
}
