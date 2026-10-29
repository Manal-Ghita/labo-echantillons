import { useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import type { StepType } from '../fabrication/api'
import {
  createCatalogueType,
  updateCatalogueType,
  validateParameters,
} from './api'
import type { ParameterInput } from './api'

type DraftParameter = ParameterInput & { draftId: number }

export function CatalogueForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: StepType
  onSaved: (type: StepType) => void
  onCancel: () => void
}) {
  const { api } = useAuth()
  const [code, setCode] = useState(initial?.code ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [active, setActive] = useState(initial?.isActive ?? true)
  const [parameters, setParameters] = useState<DraftParameter[]>([])
  const nextId = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const changeParameter = (id: number, patch: Partial<ParameterInput>) =>
    setParameters((current) =>
      current.map((item) =>
        item.draftId === id ? { ...item, ...patch } : item,
      ),
    )

  async function submit() {
    if (pending.current) return
    setError(null)
    setDetails([])
    if (!name.trim() || (!initial && !code.trim())) {
      setError('Le code et le nom sont obligatoires.')
      return
    }
    let definitions: ParameterInput[] = []
    try {
      if (!initial) definitions = validateParameters(parameters)
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const type = initial
        ? await updateCatalogueType(
            api,
            initial.id,
            {
              name: name.trim(),
              description: description || null,
              isActive: active,
            },
            controller.signal,
          )
        : await createCatalogueType(
            api,
            {
              code: code.trim(),
              name: name.trim(),
              ...(description ? { description } : {}),
              parameters: definitions,
            },
            controller.signal,
          )
      if (!controller.signal.aborted) onSaved(type)
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught)) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Enregistrement impossible.',
        )
        setDetails(caught instanceof ApiError ? caught.details : [])
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <form
      className="sample-panel sample-form"
      aria-label={
        initial ? 'Modifier le type d’opération' : 'Créer un type d’opération'
      }
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
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
        <label htmlFor="catalogue-code">Code *</label>
        <input
          id="catalogue-code"
          required
          value={code}
          disabled={!!initial || busy}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="catalogue-name">Nom *</label>
        <input
          id="catalogue-name"
          required
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="catalogue-description">Description</label>
        <textarea
          id="catalogue-description"
          rows={4}
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      {initial ? (
        <>
          <label className="catalogue-checkbox">
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(event) => setActive(event.target.checked)}
            />
            Type actif
          </label>
          <p className="muted">
            Le code et les définitions de paramètres sont immuables. Pour
            changer leur signification, créez un nouveau type et désactivez
            l’ancien. La désactivation conserve les historiques.
          </p>
        </>
      ) : (
        <>
          <h2>Définitions des paramètres</h2>
          <p className="muted">
            Elles seront immuables après création. Les clés sont sensibles à la
            casse ; les unités peuvent être définies pour chaque type de valeur.
          </p>
          {parameters.length === 0 && (
            <p>
              Aucun paramètre défini. Vous pouvez créer une opération sans
              paramètre.
            </p>
          )}
          {parameters.map((parameter, index) => (
            <fieldset
              className="parameter-fields"
              key={parameter.draftId}
              disabled={busy}
            >
              <legend>Paramètre {index + 1}</legend>
              <div className="field">
                <label htmlFor={`key-${parameter.draftId}`}>Clé *</label>
                <input
                  id={`key-${parameter.draftId}`}
                  required
                  pattern="[A-Za-z][A-Za-z0-9_]*"
                  value={parameter.key}
                  onChange={(event) =>
                    changeParameter(parameter.draftId, {
                      key: event.target.value,
                    })
                  }
                  aria-describedby={`key-help-${parameter.draftId}`}
                />
                <p className="muted" id={`key-help-${parameter.draftId}`}>
                  Lettre initiale, puis lettres, chiffres ou underscores.
                </p>
              </div>
              <div className="field">
                <label htmlFor={`name-${parameter.draftId}`}>
                  Nom du paramètre *
                </label>
                <input
                  id={`name-${parameter.draftId}`}
                  required
                  value={parameter.name}
                  onChange={(event) =>
                    changeParameter(parameter.draftId, {
                      name: event.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`type-${parameter.draftId}`}>
                  Type de valeur *
                </label>
                <select
                  id={`type-${parameter.draftId}`}
                  value={parameter.dataType}
                  onChange={(event) =>
                    changeParameter(parameter.draftId, {
                      dataType: event.target
                        .value as ParameterInput['dataType'],
                    })
                  }
                >
                  <option value="NUMBER">NUMBER — Nombre décimal</option>
                  <option value="TEXT">TEXT — Texte</option>
                  <option value="BOOLEAN">BOOLEAN — Oui ou non</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`unit-${parameter.draftId}`}>Unité</label>
                <input
                  id={`unit-${parameter.draftId}`}
                  value={parameter.unit ?? ''}
                  onChange={(event) =>
                    changeParameter(parameter.draftId, {
                      unit: event.target.value,
                    })
                  }
                />
              </div>
              <label className="catalogue-checkbox">
                <input
                  type="checkbox"
                  checked={parameter.isRequired}
                  onChange={(event) =>
                    changeParameter(parameter.draftId, {
                      isRequired: event.target.checked,
                    })
                  }
                />
                Paramètre obligatoire
              </label>
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  setParameters((current) =>
                    current.filter(
                      (item) => item.draftId !== parameter.draftId,
                    ),
                  )
                }
              >
                Retirer le paramètre {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              const draftId = ++nextId.current
              setParameters((current) => [
                ...current,
                {
                  draftId,
                  key: '',
                  name: '',
                  dataType: 'NUMBER',
                  unit: '',
                  isRequired: false,
                },
              ])
            }}
          >
            Ajouter un paramètre
          </button>
        </>
      )}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy
            ? 'Enregistrement…'
            : initial
              ? 'Enregistrer les modifications'
              : 'Créer le type'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
      {busy && <p role="status">Enregistrement du type en cours…</p>}
    </form>
  )
}
