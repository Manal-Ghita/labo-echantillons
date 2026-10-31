import { useId } from 'react'
import type { FabricationStep } from './api'
import { formatDate } from '../samples/api'
import { numericDisplay, resultDisplay } from './display'
import { StepCorrections } from './StepCorrections'
import { Attachments } from '../attachments/Attachments'

function parameterText(value: FabricationStep['parameterValues'][number]) {
  if (value.definition.dataType === 'NUMBER')
    return numericDisplay(value.numericValue, value.definition.unit)
  if (value.definition.dataType === 'BOOLEAN')
    return value.booleanValue === null
      ? 'Non renseigné'
      : value.booleanValue
        ? 'Oui'
        : 'Non'
  return value.textValue === ''
    ? 'Texte vide'
    : (value.textValue ?? 'Non renseigné')
}

export function TimelineStep({
  step,
  position,
  sampleId,
  authorized,
  onUpdated,
  expanded,
  onToggle,
}: {
  step: FabricationStep
  position: number
  sampleId: string
  authorized: boolean
  onUpdated: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const contentId = useId()
  const titleId = useId()
  const summary = step.parameterValues.length
    ? step.parameterValues
        .slice(0, 2)
        .map((value) => `${value.definition.name} : ${parameterText(value)}`)
        .join(' · ')
    : step.parameters === null
      ? 'Paramètres non renseignés'
      : step.parameters || 'Texte historique vide'
  return (
    <li className="timeline-step">
      <span className="timeline-number" aria-label={`Étape ${position}`}>
        {position}
      </span>
      <article className="timeline-card" aria-labelledby={titleId}>
        <div className="timeline-step-heading">
          <h3 id={titleId}>{step.operationName}</h3>
          <span
            className={`status-tag ${step.result === 'FAILURE' ? 'status-failure' : step.result === 'SUCCESS' ? 'status-success' : ''}`}
          >
            {resultDisplay(step.result)}
          </span>
          <button
            className="button button-secondary timeline-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={`${expanded ? 'Masquer' : 'Afficher'} les détails de l’étape ${position}`}
            onClick={onToggle}
          >
            {expanded ? 'Réduire' : 'Détails'}
          </button>
        </div>
        <time className="timeline-performed-at" dateTime={step.performedAt}>
          {formatDate(step.performedAt)}
        </time>
        <p className="timeline-summary">
          {summary}
          {step.parameterValues.length > 2
            ? ` · +${step.parameterValues.length - 2} paramètre(s)`
            : ''}
        </p>
        <div id={contentId} className="timeline-details" hidden={!expanded}>
          <dl className="sample-facts timeline-traceability">
            <div>
              <dt>Auteur de saisie</dt>
              <dd>{step.recordedBy.name}</dd>
            </div>
            {step.operator && (
              <div>
                <dt>Opérateur réel</dt>
                <dd>{step.operator.name}</dd>
              </div>
            )}
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
                    <dd className="parameter-value">{parameterText(value)}</dd>
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
          <p className="timeline-recorded-at">
            Enregistrement :{' '}
            <time dateTime={step.recordedAt}>
              {formatDate(step.recordedAt)}
            </time>
          </p>
          <Attachments
            sampleId={sampleId}
            stepId={step.id}
            authorized={authorized}
          />
          <StepCorrections
            key={step.revision ?? 0}
            step={step}
            sampleId={sampleId}
            authorized={authorized}
            onUpdated={onUpdated}
          />
        </div>
      </article>
    </li>
  )
}
