import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/context'
import type { StepType } from '../fabrication/api'
import { useSampleQuery } from '../samples/useSampleQuery'
import { getCatalogueType, listCatalogue } from './api'
import { CatalogueForm } from './CatalogueForm'
import './catalogue.css'

function ErrorMessage({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  return (
    <div>
      <p className="alert" role="alert">
        {message}
      </p>
      <button className="button button-secondary" onClick={retry}>
        Réessayer
      </button>
    </div>
  )
}
function Definitions({ type }: { type: StepType }) {
  return (
    <section aria-label="Définitions des paramètres">
      <h2>Paramètres</h2>
      {type.parameters.length === 0 ? (
        <p>Aucun paramètre défini.</p>
      ) : (
        <ul className="catalogue-parameters">
          {type.parameters.map((parameter) => (
            <li key={parameter.id}>
              <h3>{parameter.name}</h3>
              <dl className="sample-facts">
                <div>
                  <dt>Clé</dt>
                  <dd>{parameter.key}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{parameter.dataType}</dd>
                </div>
                <div>
                  <dt>Unité</dt>
                  <dd>{parameter.unit ?? 'Sans unité'}</dd>
                </div>
                <div>
                  <dt>Présence</dt>
                  <dd>{parameter.isRequired ? 'Obligatoire' : 'Facultatif'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function CataloguePage() {
  const { api, hasRole } = useAuth()
  const admin = hasRole('ADMIN')
  const [includeInactive, setIncludeInactive] = useState(false)
  const load = useCallback(
    (signal: AbortSignal) =>
      listCatalogue(api, admin && includeInactive, signal),
    [api, admin, includeInactive],
  )
  const result = useSampleQuery(load)
  return (
    <section className="page catalogue-page">
      <p className="eyebrow">ESPACE DU LABORATOIRE</p>
      <div className="page-heading">
        <div>
          <h1>Catalogue des opérations</h1>
          <p className="muted">
            Des définitions communes pour documenter les fabrications.
          </p>
        </div>
        {admin && (
          <Link to="/step-types/new" className="button button-primary">
            Créer un type d’opération
          </Link>
        )}
      </div>
      {admin && (
        <label className="catalogue-checkbox">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Inclure les types inactifs
        </label>
      )}
      {result.loading && <p role="status">Chargement du catalogue…</p>}
      {result.error && (
        <ErrorMessage message={result.error} retry={result.retry} />
      )}
      {result.data?.length === 0 && (
        <div className="placeholder-card">
          <h2>Aucun type d’opération{includeInactive ? '' : ' actif'}</h2>
          <p>
            {admin
              ? 'Créez un type et ses paramètres pour permettre la saisie des étapes.'
              : 'La responsable du catalogue pourra ajouter les opérations du laboratoire.'}
          </p>
        </div>
      )}
      {result.data && result.data.length > 0 && (
        <ul className="sample-list">
          {result.data.map((type) => (
            <li className="sample-card" key={type.id}>
              <p className="sample-reference">{type.code}</p>
              <h2>
                <Link to={`/step-types/${encodeURIComponent(type.id)}`}>
                  {type.name}
                </Link>
              </h2>
              <span className="status-tag">
                {type.isActive ? 'Actif' : 'Inactif'}
              </span>
              <p className="sample-description">
                {type.description || 'Aucune description.'}
              </p>
              <p className="muted">{type.parameters.length} paramètre(s)</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function CreateCataloguePage() {
  const navigate = useNavigate()
  return (
    <section className="page catalogue-page">
      <Link className="back-link" to="/step-types">
        ← Retour au catalogue
      </Link>
      <div className="page-heading">
        <h1>Créer un type d’opération</h1>
      </div>
      <CatalogueForm
        onCancel={() => navigate('/step-types')}
        onSaved={(type) =>
          navigate(`/step-types/${encodeURIComponent(type.id)}`, {
            replace: true,
          })
        }
      />
    </section>
  )
}

export function CatalogueDetailPage() {
  const { id = '' } = useParams()
  const { api, hasRole } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => getCatalogueType(api, id, signal),
    [api, id],
  )
  const result = useSampleQuery(load)
  return (
    <section className="page catalogue-page">
      <Link className="back-link" to="/step-types">
        ← Retour au catalogue
      </Link>
      {result.loading && <p role="status">Chargement du type d’opération…</p>}
      {result.error && (
        <ErrorMessage message={result.error} retry={result.retry} />
      )}
      {result.data && (
        <CatalogueDetails
          key={result.data.id}
          type={result.data}
          admin={hasRole('ADMIN')}
        />
      )}
    </section>
  )
}

function CatalogueDetails({ type, admin }: { type: StepType; admin: boolean }) {
  const [current, setCurrent] = useState(type)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow sample-reference">{current.code}</p>
          <h1>{current.name}</h1>
        </div>
        <span className="status-tag">
          {current.isActive ? 'Actif' : 'Inactif'}
        </span>
      </div>
      {saved && (
        <p role="status" className="catalogue-success">
          Type d’opération mis à jour.
        </p>
      )}
      <div className="sample-panel">
        <p className="sample-description">
          {current.description || 'Aucune description.'}
        </p>
        <Definitions type={current} />
      </div>
      {admin && !editing && (
        <button
          className="button button-primary catalogue-edit"
          onClick={() => {
            setSaved(false)
            setEditing(true)
          }}
        >
          Modifier le type
        </button>
      )}
      {admin && editing && (
        <div className="catalogue-edit">
          <h2>Modifier le type d’opération</h2>
          <CatalogueForm
            initial={current}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setCurrent(updated)
              setEditing(false)
              setSaved(true)
            }}
          />
        </div>
      )}
    </>
  )
}
