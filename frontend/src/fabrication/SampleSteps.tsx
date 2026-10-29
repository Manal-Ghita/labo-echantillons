import { useCallback, useState } from 'react'
import { useAuth } from '../auth/context'
import { formatDate } from '../samples/api'
import type { Sample } from '../samples/api'
import { useSampleQuery } from '../samples/useSampleQuery'
import { getSteps } from './api'
import { StepForm } from './StepForm'

export function SampleSteps({ sample }: { sample: Sample }) {
  const { api, user } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => getSteps(api, sample.id, signal),
    [api, sample.id],
  )
  const history = useSampleQuery(load)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState(false)
  const authorized = user?.role === 'ADMIN' || user?.id === sample.creatorId
  const canCreate = authorized && sample.status !== 'ABANDONED'
  return (
    <section className="fabrication-section" aria-labelledby="history-title">
      <div className="page-heading">
        <div>
          <h2 id="history-title">Historique de fabrication</h2>
          <p className="muted">De la première à la dernière réalisation.</p>
        </div>
        {canCreate && !editing && (
          <button
            className="button button-primary"
            onClick={() => {
              setNotice(false)
              setEditing(true)
            }}
          >
            Enregistrer une étape
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="success-notice">
          Étape enregistrée.
        </p>
      )}
      {sample.status === 'ABANDONED' && (
        <p className="muted">
          Cet échantillon est abandonné : aucune nouvelle étape ne peut être
          enregistrée.
        </p>
      )}
      {!authorized && (
        <p className="muted">
          L’enregistrement est réservé au propriétaire ou à ADMIN.
        </p>
      )}
      {history.loading && <p role="status">Chargement de l’historique…</p>}
      {history.error && (
        <div>
          <p role="alert" className="alert">
            {history.error}
          </p>
          <button className="button button-secondary" onClick={history.retry}>
            Réessayer l’historique
          </button>
        </div>
      )}
      {history.data?.length === 0 && (
        <p className="sample-panel">Aucune étape enregistrée.</p>
      )}
      {history.data && (
        <ol className="step-history">
          {history.data.map((step) => (
            <li className="sample-panel" key={step.id}>
              <div className="step-heading">
                <h3>{step.operationName}</h3>
                <span
                  className={`status-tag ${step.result === 'FAILURE' ? 'status-failure' : ''}`}
                >
                  {step.result === 'SUCCESS'
                    ? 'Réussie (SUCCESS)'
                    : step.result === 'FAILURE'
                      ? 'Échouée (FAILURE)'
                      : 'Résultat non renseigné'}
                </span>
              </div>
              {step.stepType && (
                <p className="muted">
                  Type : {step.stepType.code} — {step.stepType.name}
                </p>
              )}
              <dl className="sample-facts">
                <div>
                  <dt>Réalisation</dt>
                  <dd>
                    <time dateTime={step.performedAt}>
                      {formatDate(step.performedAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Auteur de saisie</dt>
                  <dd>{step.recordedBy.name}</dd>
                </div>
                <div>
                  <dt>Opérateur réel</dt>
                  <dd>{step.operator?.name ?? 'Non renseigné'}</dd>
                </div>
                <div>
                  <dt>Enregistrement</dt>
                  <dd>
                    <time dateTime={step.recordedAt}>
                      {formatDate(step.recordedAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              {step.parameterValues.length > 0 && (
                <>
                  <h4>Paramètres</h4>
                  <dl className="sample-facts">
                    {step.parameterValues.map((value) => (
                      <div key={value.id}>
                        <dt>
                          {value.definition.name}
                          {value.definition.unit
                            ? ` (${value.definition.unit})`
                            : ''}
                        </dt>
                        <dd className="parameter-value">
                          {value.definition.dataType === 'NUMBER'
                            ? value.numericValue
                            : value.definition.dataType === 'BOOLEAN'
                              ? value.booleanValue === null
                                ? 'Non renseigné'
                                : value.booleanValue
                                  ? 'Oui'
                                  : 'Non'
                              : value.textValue}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {step.parameters !== null && (
                <>
                  <h4>Paramètres textuels historiques</h4>
                  <p className="sample-description">
                    {step.parameters || 'Texte vide.'}
                  </p>
                </>
              )}
              {step.observations !== null && (
                <>
                  <h4>Observations</h4>
                  <p className="sample-description">
                    {step.observations || 'Aucune observation.'}
                  </p>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {canCreate && editing && (
        <StepForm
          sampleId={sample.id}
          onCancel={() => setEditing(false)}
          onCreated={() => {
            setEditing(false)
            setNotice(true)
            history.retry()
          }}
        />
      )}
    </section>
  )
}
