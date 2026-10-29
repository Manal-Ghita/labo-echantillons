import { StrictMode, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './context'
import { RequireAuth } from './RequireAuth'
import { SESSION_KEY } from './session'

const profile = {
  id: 'test-user',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'RESEARCHER',
  createdAt: '2026-10-29T08:00:00.000Z',
}
const loginResponse = {
  access_token: 'test-token',
  token_type: 'Bearer',
  expires_in: 3600,
}
let fetcher: ReturnType<typeof vi.fn>

function renderApp(path = '/samples', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
function validApi(role = 'RESEARCHER') {
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      Response.json(
        url.endsWith('/auth/login') ? loginResponse : { ...profile, role },
      ),
    ),
  )
}
async function signIn() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), profile.email)
  await user.type(screen.getByLabelText('Mot de passe'), 'test-password')
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
  return user
}
function stored() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ token: 'stored-token', expiresAt: Date.now() + 3600000 }),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Authentification et navigation', () => {
  it('redirige une route privée vers la connexion sans requête anonyme', async () => {
    renderApp('/step-types')
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('connecte, charge le vrai contrat de profil, puis revient à la route demandée', async () => {
    validApi()
    renderApp('/step-types')
    await signIn()
    expect(
      await screen.findByRole('heading', { name: 'Catalogue des opérations' }),
    ).toBeInTheDocument()
    expect(screen.getByText(profile.name)).toBeInTheDocument()
    expect(screen.getByText('Recherche')).toBeInTheDocument()
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:3000/auth/login')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      email: profile.email,
      password: 'test-password',
    })
    expect(fetcher.mock.calls[1][0]).toBe('http://localhost:3000/auth/me')
    expect(fetcher.mock.calls[1][1].headers.get('Authorization')).toBe(
      'Bearer test-token',
    )
    expect(sessionStorage.getItem(SESSION_KEY)).not.toContain('test-password')
    expect(sessionStorage.getItem(SESSION_KEY)).not.toContain(profile.email)
  })
  it('refuse les mauvais identifiants sans charger le profil', async () => {
    fetcher.mockResolvedValue(
      Response.json({ message: 'Unauthorized' }, { status: 401 }),
    )
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email ou mot de passe incorrect.',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('')
  })
  it('affiche le chargement tant que le profil n’est pas disponible', async () => {
    let resolveProfile!: (response: Response) => void
    fetcher.mockImplementation((url: string) =>
      url.endsWith('/auth/login')
        ? Promise.resolve(Response.json(loginResponse))
        : new Promise<Response>((resolve) => {
            resolveProfile = resolve
          }),
    )
    renderApp('/login')
    await signIn()
    expect(screen.getByRole('status')).toHaveTextContent('chargement du profil')
    expect(screen.getByRole('button', { name: /Connexion/ })).toBeDisabled()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await act(async () => resolveProfile(Response.json(profile)))
    expect(
      await screen.findByRole('heading', { name: 'Échantillons' }),
    ).toBeInTheDocument()
  })
  it('ne valide pas une session si le chargement du profil échoue', async () => {
    fetcher
      .mockResolvedValueOnce(Response.json(loginResponse))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'droits nécessaires',
    )
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('gère une panne réseau sans authentifier l’utilisateur', async () => {
    fetcher.mockRejectedValue(new TypeError('Network unavailable'))
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
  })
  it('revalide le profil après rechargement et affiche son chargement', async () => {
    stored()
    let complete!: (response: Response) => void
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve
        }),
    )
    renderApp('/samples')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Chargement de votre profil',
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await act(async () => complete(Response.json(profile)))
    expect(await screen.findByText(profile.name)).toBeInTheDocument()
    expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe(
      'Bearer stored-token',
    )
  })
  it('supprime une session refusée en 401 et retourne au login', async () => {
    stored()
    fetcher.mockResolvedValue(Response.json({}, { status: 401 }))
    renderApp('/step-types')
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('session a expiré')
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('rejette une session corrompue ou expirée sans accès réseau', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: 'old-token', expiresAt: Date.now() - 1 }),
    )
    renderApp()
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('navigue entre les pages provisoires et déconnecte', async () => {
    validApi('ADMIN')
    renderApp()
    const user = await signIn()
    expect(await screen.findByText('Administration')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Catalogue' }))
    expect(
      await screen.findByRole('heading', { name: 'Catalogue des opérations' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Catalogue' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('refuse un profil contenant un rôle inconnu', async () => {
    validApi('SUPERUSER')
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'profil renvoyé par le serveur est invalide',
    )
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('refuse une réponse de connexion qui ne respecte pas le contrat', async () => {
    fetcher.mockResolvedValue(Response.json({ token: 'wrong-field' }))
    renderApp('/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'réponse de connexion est invalide',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('reste fonctionnel avec StrictMode et une session restaurée', async () => {
    stored()
    validApi()
    renderApp('/samples', true)
    expect(await screen.findByText(profile.name)).toBeInTheDocument()
  })
})

function Probe() {
  const auth = useAuth()
  const [error, setError] = useState('')
  return (
    <>
      <p>{auth.user?.name}</p>
      <button
        onClick={() => {
          void auth.api
            .request('/probe')
            .catch((caught) => setError(caught.message))
        }}
      >
        Requête privée
      </button>
      <p role="alert">{error}</p>
    </>
  )
}

describe('Session et droits', () => {
  function renderProbe(roles?: ('ADMIN' | 'RESEARCHER')[]) {
    return render(
      <MemoryRouter initialEntries={['/private']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<p>Retour connexion</p>} />
            <Route element={<RequireAuth roles={roles} />}>
              <Route path="/private" element={<Probe />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
  }
  it('conserve l’identité sur 403 et affiche le refus', async () => {
    stored()
    fetcher
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    renderProbe()
    await screen.findByText(profile.name)
    await userEvent.click(
      screen.getByRole('button', { name: 'Requête privée' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'droits nécessaires',
    )
    expect(screen.getByText(profile.name)).toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull()
  })
  it('ferme la session sur 401 depuis une requête privée', async () => {
    stored()
    fetcher
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    renderProbe()
    await screen.findByText(profile.name)
    await userEvent.click(
      screen.getByRole('button', { name: 'Requête privée' }),
    )
    expect(await screen.findByText('Retour connexion')).toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('interdit une page ADMIN à RESEARCHER', async () => {
    stored()
    validApi()
    renderProbe(['ADMIN'])
    expect(
      await screen.findByRole('heading', { name: 'Accès non autorisé' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('autorise une page ADMIN au rôle issu du profil serveur', async () => {
    stored()
    validApi('ADMIN')
    renderProbe(['ADMIN'])
    expect(
      await screen.findByRole('button', { name: 'Requête privée' }),
    ).toBeInTheDocument()
  })
  it('expire la session sans requête supplémentaire après la durée indiquée', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: 'short-token', expiresAt: Date.now() + 1000 }),
    )
    validApi()
    renderProbe()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(screen.getByText('Retour connexion')).toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

function RaceProbe() {
  const auth = useAuth()
  return (
    <>
      <p>{auth.status}</p>
      <p>{auth.user?.name}</p>
      <button
        onClick={() => {
          void auth.api.request('/slow').catch(() => {})
        }}
      >
        Ancienne requête
      </button>
      <button
        onClick={() => {
          void auth
            .login('new@example.test', 'new-test-password')
            .catch(() => {})
        }}
      >
        Nouvelle session
      </button>
      <button onClick={auth.logout}>Déconnexion immédiate</button>
    </>
  )
}

describe('Réponses tardives et fermeture de session', () => {
  it('ne rétablit pas le profil après une déconnexion pendant son chargement', async () => {
    stored()
    let finish!: (response: Response) => void
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    render(
      <AuthProvider>
        <RaceProbe />
      </AuthProvider>,
    )
    expect(screen.getByText('checking')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Déconnexion immédiate' }),
    )
    await act(async () => finish(Response.json(profile)))
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(screen.queryByText(profile.name)).not.toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('ne ferme pas une nouvelle session à cause d’un ancien 401', async () => {
    stored()
    let rejectOld!: (response: Response) => void
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith('/slow'))
        return new Promise<Response>((resolve) => {
          rejectOld = resolve
        })
      if (url.endsWith('/auth/login'))
        return Promise.resolve(
          Response.json({ ...loginResponse, access_token: 'new-test-token' }),
        )
      const current = new Headers(init.headers).get('Authorization')
      return Promise.resolve(
        Response.json(
          current === 'Bearer new-test-token'
            ? { ...profile, name: 'Nouvelle identité' }
            : profile,
        ),
      )
    })
    render(
      <AuthProvider>
        <RaceProbe />
      </AuthProvider>,
    )
    await screen.findByText(profile.name)
    await userEvent.click(
      screen.getByRole('button', { name: 'Ancienne requête' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Nouvelle session' }),
    )
    await screen.findByText('Nouvelle identité')
    await act(async () => rejectOld(Response.json({}, { status: 401 })))
    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('Nouvelle identité')).toBeInTheDocument()
    expect(sessionStorage.getItem(SESSION_KEY)).toContain('new-test-token')
  })
  it('continue en mémoire si l’écriture du stockage navigateur est indisponible', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError')
    })
    validApi()
    renderApp('/login')
    await signIn()
    await waitFor(() =>
      expect(screen.getByText(profile.name)).toBeInTheDocument(),
    )
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})
