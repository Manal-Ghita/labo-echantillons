import { useCallback, useState } from 'react'
import { useAuth } from '../auth/context'
import type { ParameterDefinition } from '../fabrication/api'
import { useSampleQuery } from './useSampleQuery'

export function NumericSearch({
  definitionId,
  min,
  max,
  hidden = false,
}: {
  definitionId: string
  min: string
  max: string
  hidden?: boolean
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
  const unit = definitions?.find(
    (definition) => definition.id === selected,
  )?.unit
  return (
    <fieldset
      className="parameter-fields numeric-filters"
      id="numeric-filters"
      hidden={hidden}
    >
      <legend>Paramètre numérique</legend>
      <p className="muted">
        Retrouver les échantillons dont une étape a une valeur comprise entre
        ces deux bornes.
      </p>
      <p className="muted numeric-input-help" id="numeric-input-help">
        Bornes inclusives. Point décimal, sans exposant.
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
        <label htmlFor="numeric-definition">Paramètre</label>
        <select
          id="numeric-definition"
          name="parameterDefinitionId"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choisir un paramètre</option>
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
          aria-describedby={
            unit ? 'numeric-input-help numeric-min-unit' : 'numeric-input-help'
          }
        />
        {unit && (
          <span className="numeric-unit" id="numeric-min-unit">
            {unit}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="numeric-max">Valeur maximale</label>
        <input
          id="numeric-max"
          name="max"
          type="text"
          inputMode="decimal"
          defaultValue={max}
          aria-describedby={
            unit ? 'numeric-input-help numeric-max-unit' : 'numeric-input-help'
          }
        />
        {unit && (
          <span className="numeric-unit" id="numeric-max-unit">
            {unit}
          </span>
        )}
      </div>
    </fieldset>
  )
}
