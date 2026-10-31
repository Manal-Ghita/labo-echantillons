import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import type { ParameterDefinition } from '../fabrication/api'
import { useSampleQuery } from './useSampleQuery'
import { readNumericFilters } from './advanced-query'
import type { AdvancedQuery, NumericFilter } from './advanced-query'
import './advanced-search.css'

type Operation = { id: string; code: string; name: string; isActive: boolean }
type Definition = ParameterDefinition & { stepType: Omit<Operation, 'id'> }

export function AdvancedSearch({
  initial,
  legacySelected,
  onEdit,
}: {
  initial: AdvancedQuery
  legacySelected: boolean
  onEdit: () => void
}) {
  const active = Object.values(initial).some(Boolean)
  const [expanded, setExpanded] = useState(active)
  const [mounted, setMounted] = useState(active)
  return (
    <div className="advanced-search">
      <button
        type="button"
        className="button button-secondary"
        aria-expanded={expanded}
        aria-controls="advanced-criteria"
        onClick={() => {
          setMounted(true)
          setExpanded((v) => !v)
        }}
      >
        {expanded ? 'Masquer les critères avancés' : 'Ajouter des critères'}
      </button>
      {mounted && (
        <Criteria
          initial={initial}
          legacySelected={legacySelected}
          hidden={!expanded}
          onEdit={onEdit}
        />
      )}
    </div>
  )
}

function Criteria({
  initial,
  legacySelected,
  hidden,
  onEdit,
}: {
  initial: AdvancedQuery
  legacySelected: boolean
  hidden: boolean
  onEdit: () => void
}) {
  const { api } = useAuth()
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [batches, types, definitions] = await Promise.all([
        api.request<{ id: string; reference: string }[]>('/batches', {
          signal,
        }),
        api.request<Operation[]>('/samples/search-operation-types', { signal }),
        api.request<Definition[]>('/samples/numeric-parameters', { signal }),
      ])
      return { batches, types, definitions }
    },
    [api],
  )
  const options = useSampleQuery(load)
  const parsed = readNumericFilters(initial.numericFilters)
  const [invalidRaw, setInvalidRaw] = useState(parsed === null)
  const next = useRef(parsed?.length ?? 0)
  const [rows, setRows] = useState(() =>
    (parsed ?? []).map((row, id) => ({
      ...row,
      id,
      comparison: row.eq !== undefined ? 'exact' : 'range',
    })),
  )
  const [status, setStatus] = useState(initial.status)
  const [batchId, setBatch] = useState(initial.batchId)
  const [stepTypeId, setType] = useState(initial.stepTypeId)
  const [matchMode, setMode] = useState(initial.matchMode || 'ANY_STEP')
  const filters: NumericFilter[] = rows.map((row) => ({
    parameterDefinitionId: row.parameterDefinitionId,
    ...(row.comparison === 'exact'
      ? { eq: (row.eq ?? '').trim() }
      : {
          ...(row.min?.trim() ? { min: row.min.trim() } : {}),
          ...(row.max?.trim() ? { max: row.max.trim() } : {}),
        }),
  }))
  function update(id: number, patch: Partial<(typeof rows)[number]>) {
    onEdit()
    setInvalidRaw(false)
    setRows((values) =>
      values.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }
  return (
    <fieldset
      id="advanced-criteria"
      className="advanced-criteria"
      hidden={hidden}
    >
      <legend>Critères avancés combinés avec ET</legend>
      <p className="muted">
        La référence ou le nom, le statut et le lot s’appliquent à
        l’échantillon. Fermer le panneau conserve les filtres saisis.
      </p>
      {options.loading && <p role="status">Chargement des critères…</p>}
      {options.error && (
        <p role="alert" className="alert">
          {options.error}
          <button type="button" onClick={options.retry}>
            Réessayer les critères
          </button>
        </p>
      )}
      {invalidRaw && (
        <p role="alert" className="alert">
          Les critères de cette URL sont invalides. Ajoutez un nouveau critère
          pour les remplacer.
        </p>
      )}
      <div className="advanced-meta">
        <div className="field">
          <label htmlFor="advanced-status">Statut</label>
          <select
            id="advanced-status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tous les statuts</option>
            <option value="ACTIVE">Actif</option>
            <option value="ABANDONED">Abandonné</option>
            <option value="UNSPECIFIED">Non renseigné</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="advanced-batch">Lot</label>
          <select
            id="advanced-batch"
            name="batchId"
            value={batchId}
            onChange={(e) => setBatch(e.target.value)}
          >
            <option value="">Tous les lots</option>
            {batchId &&
              !options.data?.batches.some((b) => b.id === batchId) && (
                <option value={batchId}>Lot sélectionné (indisponible)</option>
              )}
            {options.data?.batches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.reference}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="advanced-operation">Type d’opération recherché</label>
          <select
            id="advanced-operation"
            name="stepTypeId"
            value={stepTypeId}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Tous les types</option>
            {stepTypeId &&
              !options.data?.types.some((t) => t.id === stepTypeId) && (
                <option value={stepTypeId}>
                  Type sélectionné (indisponible)
                </option>
              )}
            {options.data?.types.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
                {t.isActive ? '' : ' (archivé)'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="advanced-mode">Portée du type et des paramètres</label>
        <select
          id="advanced-mode"
          name="matchMode"
          value={matchMode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="ANY_STEP">Une ou plusieurs étapes</option>
          <option value="SAME_STEP">Une même étape</option>
        </select>
      </div>
      <p className="muted">
        Même étape : le type et tous les paramètres doivent correspondre à une
        réalisation unique. Une ou plusieurs étapes : chaque condition peut
        provenir d’une réalisation différente du même échantillon. Le paramètre
        simple ci-dessus est inclus.
      </p>
      <p className="muted" id="advanced-decimal-help">
        Bornes inclusives. Valeurs courantes, réussites et échecs compris. Point
        décimal, sans exposant ; les chiffres sont conservés sans arrondi.
      </p>
      <input
        type="hidden"
        name="numericFilters"
        value={
          invalidRaw
            ? initial.numericFilters
            : filters.length
              ? JSON.stringify(filters)
              : ''
        }
      />
      {rows.map((row, index) => {
        const definition = options.data?.definitions.find(
          (d) => d.id === row.parameterDefinitionId,
        )
        const valueField = (key: 'eq' | 'min' | 'max', label: string) => (
          <div className="field">
            <label htmlFor={`criterion-${row.id}-${key}`}>
              {label} du critère {index + 1}
            </label>
            <input
              id={`criterion-${row.id}-${key}`}
              type="text"
              inputMode="decimal"
              value={row[key] ?? ''}
              onChange={(e) => update(row.id, { [key]: e.target.value })}
              aria-describedby={`advanced-decimal-help${definition?.unit ? ` criterion-${row.id}-${key}-unit` : ''}`}
            />
            {definition?.unit && (
              <span
                className="numeric-unit"
                id={`criterion-${row.id}-${key}-unit`}
              >
                {definition.unit}
              </span>
            )}
          </div>
        )
        return (
          <fieldset className="advanced-row" key={row.id}>
            <legend>Critère numérique {index + 1}</legend>
            <div className="field advanced-definition">
              <label htmlFor={`criterion-${row.id}-definition`}>
                Paramètre du critère {index + 1}
              </label>
              <select
                id={`criterion-${row.id}-definition`}
                value={row.parameterDefinitionId}
                onChange={(e) =>
                  update(row.id, { parameterDefinitionId: e.target.value })
                }
              >
                <option value="">Choisir un paramètre</option>
                {row.parameterDefinitionId && !definition && (
                  <option value={row.parameterDefinitionId}>
                    Paramètre sélectionné (indisponible)
                  </option>
                )}
                {options.data?.definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.stepType.name} / {d.name}
                    {d.unit && !d.name.endsWith(`(${d.unit})`)
                      ? ` (${d.unit})`
                      : ''}
                    {d.stepType.isActive ? '' : ' (archivé)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`criterion-${row.id}-comparison`}>
                Comparaison du critère {index + 1}
              </label>
              <select
                id={`criterion-${row.id}-comparison`}
                value={row.comparison}
                onChange={(e) => update(row.id, { comparison: e.target.value })}
              >
                <option value="range">Intervalle</option>
                <option value="exact">Valeur exacte</option>
              </select>
            </div>
            <div className="advanced-values">
              {row.comparison === 'exact' ? (
                valueField('eq', 'Valeur exacte')
              ) : (
                <>
                  {valueField('min', 'Minimum')}
                  {valueField('max', 'Maximum')}
                </>
              )}
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                onEdit()
                setInvalidRaw(false)
                setRows((values) => values.filter((v) => v.id !== row.id))
              }}
            >
              Retirer le critère numérique {index + 1}
            </button>
          </fieldset>
        )
      })}
      <p className="muted">
        {rows.length + (legacySelected ? 1 : 0)} / 10 critères numériques,
        paramètre simple inclus.
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={rows.length + (legacySelected ? 1 : 0) >= 10}
        onClick={() => {
          onEdit()
          setInvalidRaw(false)
          setRows((values) => [
            ...values,
            {
              id: next.current++,
              parameterDefinitionId: '',
              comparison: 'range',
            },
          ])
        }}
      >
        Ajouter un critère numérique
      </button>
    </fieldset>
  )
}
