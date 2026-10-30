import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import type { UserProfile } from '../auth/types'
import { SidePanel } from '../components/SidePanel'

export function CreateResearcherPanel({
  openerRef,
  onClose,
  onCreated,
}: {
  openerRef: RefObject<HTMLElement | null>
  onClose: () => void
  onCreated: () => void
}) {
  const { api } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const pending = useRef<AbortController | null>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (error) {
      errorSummary.current?.focus()
      errorSummary.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [error, fieldErrors])
  async function submit() {
    if (pending.current) return
    const invalid: Record<string, string> = {}
    if (!name.trim()) invalid.name = 'Indiquez le nom du chercheur.'
    if (!email.trim()) invalid.email = 'Indiquez l’email du chercheur.'
    // Match class-validator's Unicode-aware minimum length.
    const length =
      password.length -
      (password.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g)?.length ?? 0) -
      (password.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0)
    if (length < 12)
      invalid.password = 'Le mot de passe doit contenir au moins 12 caractères.'
    if (new TextEncoder().encode(password).length > 72)
      invalid.password =
        'Le mot de passe dépasse 72 octets UTF-8. Réduisez sa longueur ; les caractères accentués et les emojis occupent plusieurs octets.'
    setFieldErrors(invalid)
    setError(null)
    if (Object.keys(invalid).length) {
      setError('Vérifiez les champs indiqués.')
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      await api.request<UserProfile>('/users', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password },
        signal: controller.signal,
      })
      if (!controller.signal.aborted) onCreated()
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? caught.status === 409
              ? 'Cet email est déjà utilisé.'
              : [caught.message, ...caught.details].join(' ')
            : 'Création du compte impossible. Réessayez.',
        )
    } finally {
      pending.current = null
      if (!controller.signal.aborted) {
        setBusy(false)
        setPassword('')
        setVisible(false)
      }
    }
  }
  return (
    <SidePanel
      id="researcher-panel"
      title="Ajouter un chercheur"
      openerRef={openerRef}
      busy={busy}
      dirty={dirty}
      onClose={onClose}
      footer={(close) => (
        <div className="side-panel-actions">
          <button
            type="submit"
            form="create-researcher"
            className="button button-primary"
            disabled={busy}
          >
            {busy ? 'Création en cours…' : 'Créer le compte'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={close}
          >
            Annuler
          </button>
        </div>
      )}
    >
      {() => (
        <form
          id="create-researcher"
          className="researcher-form"
          aria-label="Créer un compte chercheur"
          aria-busy={busy}
          onChangeCapture={() => setDirty(true)}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {error && (
            <div
              className="alert"
              role="alert"
              tabIndex={-1}
              ref={errorSummary}
            >
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="researcher-name">Nom complet *</label>
            <input
              id="researcher-name"
              placeholder="Ex. Karim Benali"
              value={name}
              required
              disabled={busy}
              autoComplete="name"
              aria-invalid={!!fieldErrors.name}
              aria-describedby={
                fieldErrors.name ? 'researcher-name-error' : undefined
              }
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name && (
              <p className="researcher-field-error" id="researcher-name-error">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="researcher-email">Adresse e-mail *</label>
            <input
              id="researcher-email"
              placeholder="prenom.nom@labo.com"
              type="email"
              value={email}
              required
              maxLength={254}
              disabled={busy}
              autoComplete="off"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={
                fieldErrors.email ? 'researcher-email-error' : undefined
              }
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email && (
              <p className="researcher-field-error" id="researcher-email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="researcher-password">Mot de passe initial *</label>
            <div className="researcher-password-field">
              <input
                id="researcher-password"
                type={visible ? 'text' : 'password'}
                value={password}
                required
                autoComplete="new-password"
                disabled={busy}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={`researcher-password-help${fieldErrors.password ? ' researcher-password-error' : ''}`}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="researcher-password-toggle"
                aria-label={
                  visible
                    ? 'Masquer le mot de passe'
                    : 'Afficher le mot de passe'
                }
                aria-controls="researcher-password"
                aria-pressed={visible}
                disabled={busy}
                onClick={() => setVisible((current) => !current)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {visible && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            <p className="muted" id="researcher-password-help">
              Au moins 12 caractères
            </p>
            {fieldErrors.password && (
              <p
                className="researcher-field-error"
                id="researcher-password-error"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>
        </form>
      )}
    </SidePanel>
  )
}
