import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'
import type { UserProfile } from '../auth/types'
import { useSampleQuery } from '../samples/useSampleQuery'
import './users.css'

export function UsersPage() {
  const { api } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => api.request<UserProfile[]>('/users', { signal }),
    [api],
  )
  const users = useSampleQuery(load)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit() {
    if (pending.current) return
    setError(null)
    setNotice(false)
    if (
      !name.trim() ||
      !email.trim() ||
      password.length < 12 ||
      new TextEncoder().encode(password).length > 72 ||
      password !== confirmation
    ) {
      setError(
        'Vérifiez le nom, l’email et les mots de passe identiques (12 caractères minimum, 72 octets UTF-8 maximum).',
      )
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
      if (!controller.signal.aborted) {
        setName('')
        setEmail('')
        setNotice(true)
        users.retry()
      }
    } catch (caught) {
      if (!controller.signal.aborted && !isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? [caught.message, ...caught.details].join(' ')
            : 'Création impossible.',
        )
    } finally {
      pending.current = null
      if (!controller.signal.aborted) {
        setBusy(false)
        setPassword('')
        setConfirmation('')
      }
    }
  }
  return (
    <section className="page users-page">
      <div className="page-heading">
        <div>
          <h1>Comptes du laboratoire</h1>
          <p className="muted">
            Création contrôlée de comptes RESEARCHER, réservée à ADMIN.
          </p>
        </div>
      </div>
      {notice && <p role="status">Compte RESEARCHER créé.</p>}
      <form
        className="sample-panel sample-form"
        aria-label="Créer un compte RESEARCHER"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        aria-busy={busy}
      >
        <h2>Nouveau chercheur</h2>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="researcher-name">Nom du chercheur *</label>
          <input
            id="researcher-name"
            required
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="researcher-email">Email du chercheur *</label>
          <input
            id="researcher-email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="researcher-password">Mot de passe initial *</label>
          <input
            id="researcher-password"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="researcher-confirm">
            Confirmer le mot de passe *
          </label>
          <input
            id="researcher-confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <p className="muted">
          Au moins 12 caractères, au plus 72 octets UTF-8. Aucun rôle ADMIN ne
          peut être attribué par ce formulaire.
        </p>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Création…' : 'Créer le compte RESEARCHER'}
        </button>
      </form>
      <section className="users-list">
        <h2>Utilisateurs existants</h2>
        {users.loading && <p role="status">Chargement des comptes…</p>}
        {users.error && (
          <>
            <p role="alert" className="alert">
              {users.error}
            </p>
            <button className="button button-secondary" onClick={users.retry}>
              Réessayer les comptes
            </button>
          </>
        )}
        {users.data && (
          <ul className="sample-list">
            {users.data.map((user) => (
              <li key={user.id} className="sample-card">
                <h3>{user.name}</h3>
                <p>{user.email}</p>
                <span className="status-tag">{user.role}</span>
                <p className="sample-reference">{user.id}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
