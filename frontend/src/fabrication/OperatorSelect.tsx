import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/context'
import { useSampleQuery } from '../samples/useSampleQuery'

export type Operator = { id: string; name: string }
const normalized = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')

export function OperatorSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  disabled: boolean
}) {
  const { api, user } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) =>
      api.request<Operator[]>('/users/operators', { signal }),
    [api],
  )
  const operators = useSampleQuery(load)
  const [query, setQuery] = useState('')
  const matches =
    operators.data?.filter((operator) =>
      normalized(operator.name).includes(normalized(query.trim())),
    ) ?? []
  const visible =
    operators.data?.filter(
      (operator) =>
        operator.id === value ||
        matches.some((match) => match.id === operator.id),
    ) ?? []
  useEffect(() => {
    if (
      !operators.loading &&
      value &&
      !operators.data?.some((operator) => operator.id === value)
    )
      onChange('')
  }, [operators.loading, operators.data, value, onChange])
  return (
    <fieldset className="operator-picker" disabled={disabled}>
      <legend>Opérateur réel (facultatif)</legend>
      {operators.loading && <p role="status">Chargement des opérateurs…</p>}
      {operators.error && (
        <div>
          <p role="alert" className="alert">
            Impossible de charger les opérateurs. {operators.error} Vous pouvez
            enregistrer l’étape sans opérateur.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={operators.retry}
          >
            Réessayer les opérateurs
          </button>
        </div>
      )}
      {operators.data?.length === 0 && (
        <p role="status">
          Aucun opérateur disponible. Vous pouvez enregistrer l’étape sans
          opérateur.
        </p>
      )}
      <div className="field">
        <label htmlFor="operator-search">Rechercher un opérateur par nom</label>
        <input
          id="operator-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled || operators.loading || !operators.data?.length}
        />
      </div>
      {operators.data && query && matches.length === 0 && (
        <p role="status">
          Aucun nom correspondant. La sélection actuelle est conservée.
        </p>
      )}
      <div className="field">
        <label htmlFor="step-operator">Opérateur réel</label>
        <select
          id="step-operator"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || operators.loading || !operators.data?.length}
          aria-describedby="operator-help"
        >
          <option value="">Non renseigné</option>
          {operators.loading && value === user?.id && (
            <option value={value}>Moi — {user.name}</option>
          )}
          {visible.map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.id === user?.id
                ? `Moi — ${operator.name}`
                : operator.name}
            </option>
          ))}
        </select>
      </div>
      <p id="operator-help" className="muted">
        Personne ayant réalisé l’opération. L’auteur de saisie reste votre
        compte connecté.
      </p>
    </fieldset>
  )
}
