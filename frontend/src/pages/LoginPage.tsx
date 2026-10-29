import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError, isAbortError } from '../api/client'
import { useAuth } from '../auth/context'

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = location.state as { from?: unknown } | null
  const from =
    typeof state?.from === 'string' &&
    state.from.startsWith('/') &&
    !state.from.startsWith('//') &&
    !state.from.includes('\\') &&
    !/^\/login(?:[/?#]|$)/.test(state.from)
      ? state.from
      : '/samples'
  if (auth.status === 'checking')
    return (
      <main className="session-loading" role="status">
        Chargement de votre profil…
      </main>
    )
  if (auth.user) return <Navigate to={from} replace />
  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await auth.login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (caught) {
      if (!isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'La connexion a échoué. Veuillez réessayer.',
        )
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }
  return (
    <main className="login-shell">
      <section className="login-intro" aria-label="Les échantillons du labo">
        <div className="brand brand-light">
          <span className="brand-mark" aria-hidden="true">
            L.
          </span>
          <span>
            Les échantillons
            <br />
            <strong>du labo</strong>
          </span>
        </div>
        <div className="intro-copy">
          <p className="eyebrow">DU PREMIER DÉPÔT AU DERNIER RÉGLAGE</p>
          <h1>
            Gardez le fil
            <br />
            de vos fabrications.
          </h1>
          <p>
            Un espace commun pour suivre vos échantillons et retrouver
            l’histoire de chaque étape.
          </p>
          <div className="sample-lines" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <p className="intro-footer">
          Microélectronique · Recherche · Traçabilité
        </p>
      </section>
      <section className="login-form-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="eyebrow">VOTRE ESPACE DE RECHERCHE</p>
          <h2 id="login-title">Connexion</h2>
          <p className="muted">
            Connectez-vous avec votre compte du laboratoire.
          </p>
          {(error || auth.notice) && (
            <p className="alert" role="alert">
              {error || auth.notice}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              disabled={submitting}
            />
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={72}
              disabled={submitting}
            />
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Connexion…' : 'Se connecter'}
              <span aria-hidden="true">→</span>
            </button>
            {submitting && (
              <p className="form-status" role="status">
                Vérification de votre compte et chargement du profil…
              </p>
            )}
          </form>
          <p className="access-help">
            Vous n’avez pas de compte ? Adressez-vous à la responsable du
            laboratoire.
          </p>
        </div>
        <p className="login-footer">Les échantillons du labo · ISMIN 2026</p>
      </section>
    </main>
  )
}
