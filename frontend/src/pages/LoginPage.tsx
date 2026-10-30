import { useRef, useState } from 'react'
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
  const pending = useRef(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordHelp, setShowPasswordHelp] = useState(false)
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
    if (pending.current) return
    pending.current = true
    setSubmitting(true)
    setError(null)
    try {
      await auth.login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (caught) {
      if (!isAbortError(caught))
        setError(
          caught instanceof ApiError
            ? caught.status === 401
              ? 'Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe.'
              : caught.message
            : 'La connexion a échoué. Veuillez réessayer.',
        )
    } finally {
      setPassword('')
      setShowPassword(false)
      pending.current = false
      setSubmitting(false)
    }
  }
  return (
    <main className="login-shell">
      <section className="login-intro" aria-label="Les échantillons du labo">
        <img className="login-photo" src="/images/wafer-login.png" alt="" />
        <div className="intro-copy">
          <p className="intro-lab">Centre de microélectronique</p>
          <h1>Plateforme de gestion des échantillons</h1>
          <p className="login-features">
            Suivi des échantillons, historique des opérations et
            traçabilité des fabrications.
          </p>
</div>
      </section>
      <section className="login-form-panel" aria-labelledby="login-title">
        <div className="login-card">
          <img
            className="login-logo"
            src="/images/logo-labo.png"
            alt="Les échantillons du labo"
          />
          <p className="login-platform-name">LIMS Salle Blanche</p>
          <h2 id="login-title">Connexion</h2>
          {(error || auth.notice) && (
            <p className="alert" role="alert">
              {error || auth.notice}
            </p>
          )}
          <form
            aria-busy={submitting}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <label htmlFor="email">Adresse e-mail</label>
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
            <div className="login-password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                maxLength={72}
                disabled={submitting}
              />
              <button
                type="button"
                className="login-password-toggle"
                aria-label={
                  showPassword
                    ? 'Masquer le mot de passe'
                    : 'Afficher le mot de passe'
                }
                aria-controls="password"
                aria-pressed={showPassword}
                disabled={submitting}
                onClick={() => setShowPassword((value) => !value)}
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
                  {showPassword && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="login-help-toggle"
              aria-expanded={showPasswordHelp}
              aria-controls="password-help"
              onClick={() => setShowPasswordHelp((value) => !value)}
            >
              Mot de passe oublié ?
            </button>
            {showPasswordHelp && (
              <p
                id="password-help"
                className="login-password-help"
                role="status"
              >
                Pour réinitialiser votre mot de passe, contactez la responsable
                du laboratoire.
              </p>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting && (
                <span className="login-spinner" aria-hidden="true" />
              )}
              {submitting ? 'Connexion en cours…' : 'Se connecter'}
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
      </section>
    </main>
  )
}
