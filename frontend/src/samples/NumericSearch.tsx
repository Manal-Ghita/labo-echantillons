import { useCallback, useState } from 'react'
import { useAuth } from '../auth/context'
import type { ParameterDefinition } from '../fabrication/api'
import { useSampleQuery } from './useSampleQuery'

export function NumericSearch({
  definitionId,
  min,
  max,
}: {
  definitionId: string
  min: string
  max: string
}) {
  const { api } = useAuth()
  const [selected, setSelected] = useState(definitionId)
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<
        (ParameterDefinition & {
          stepType: { code: string; name: string; isActive: boolean }
        })[]
      >('/samples/numeric-parameters', { signal }),
    [api],
  )
  const catalogue = useSampleQuery(load)
  const definitions = catalogue.data?.map((p) => ({
    ...p,
    operation: `${p.stepType.code} — ${p.stepType.name}${p.stepType.isActive ? '' : ' (archivé)'}`,
  }))
  return (
    <fieldset className="parameter-fields">
      <legend>Paramètre numérique</legend>
      <p className="muted">
        Bornes inclusives sur la valeur courante d’une étape, réussie ou
        échouée. Point décimal, sans exposant.
      </p>
      {catalogue.loading && <p role="status">Chargement des paramètres…</p>}
      {catalogue.error && (
        <>
          <p className="alert" role="alert">
            {catalogue.error}
          </p>
          <button
            className="button button-secondary"
            type="button"
            onClick={catalogue.retry}
          >
            Réessayer les paramètres
          </button>
        </>
      )}
      <div className="field">
        <label htmlFor="numeric-definition">Définition du paramètre</label>
        <select
          id="numeric-definition"
          name="parameterDefinitionId"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Sans filtre numérique</option>
          {selected && !definitions?.some((p) => p.id === selected) && (
            <option value={selected}>
              Définition sélectionnée : {selected}
            </option>
          )}
          {definitions?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.operation} / {p.name}
              {p.unit ? ` (${p.unit})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="numeric-min">Valeur minimale</label>
        <input
          id="numeric-min"
          name="min"
          type="text"
          inputMode="decimal"
          defaultValue={min}
        />
      </div>
      <div className="field">
        <label htmlFor="numeric-max">Valeur maximale</label>
        <input
          id="numeric-max"
          name="max"
          type="text"
          inputMode="decimal"
          defaultValue={max}
        />
      </div>
    </fieldset>
  )
}
