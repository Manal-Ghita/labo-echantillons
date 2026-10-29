import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'
import { normalizeApiUrl } from '../config'

afterEach(() => vi.unstubAllGlobals())

describe('Client HTTP', () => {
  function setup() {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const onUnauthorized = vi.fn()
    const api = createApiClient({
      baseUrl: 'http://localhost:3000/',
      getToken: () => 'session-test',
      onUnauthorized,
    })
    return { api, fetcher, onUnauthorized }
  }
  it('envoie le JWT et le JSON uniquement vers la base API configurée', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(Response.json({ ok: true }))
    await expect(
      api.request('/example', { method: 'POST', body: { value: 'test' } }),
    ).resolves.toEqual({ ok: true })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://localhost:3000/example')
    expect(init.headers.get('Authorization')).toBe('Bearer session-test')
    expect(init.headers.get('Content-Type')).toBe('application/json')
    expect(init.body).toBe('{"value":"test"}')
    expect(init.credentials).toBe('omit')
  })
  it('n’envoie pas de JWT pour la connexion publique', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(Response.json({}))
    await api.request('/auth/login', {
      authenticated: false,
      method: 'POST',
      body: { email: 'test@example.test', password: 'fixture' },
    })
    expect(fetcher.mock.calls[0][1].headers.has('Authorization')).toBe(false)
    expect(fetcher.mock.calls[0][0]).not.toContain('password')
  })
  it('signale un 401 de session au contexte', async () => {
    const { api, fetcher, onUnauthorized } = setup()
    fetcher.mockResolvedValue(
      Response.json({ message: 'Unauthorized' }, { status: 401 }),
    )
    await expect(api.request('/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledWith('session-test')
  })
  it('ne déconnecte pas sur un login refusé', async () => {
    const { api, fetcher, onUnauthorized } = setup()
    fetcher.mockResolvedValue(Response.json({}, { status: 401 }))
    await expect(
      api.request('/auth/login', { authenticated: false }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Email ou mot de passe incorrect.',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('conserve la session sur une réponse 403', async () => {
    const { api, fetcher, onUnauthorized } = setup()
    fetcher.mockResolvedValue(Response.json({}, { status: 403 }))
    await expect(api.request('/admin')).rejects.toMatchObject({
      status: 403,
      message: 'Vous n’avez pas les droits nécessaires pour cette action.',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('conserve les détails de validation sans dépendre du format d’erreur complet', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(
      Response.json(
        {
          statusCode: 400,
          message: ['email must be an email'],
          error: 'Bad Request',
        },
        { status: 400 },
      ),
    )
    await expect(api.request('/example')).rejects.toMatchObject({
      status: 400,
      details: ['email must be an email'],
    })
  })
  it('gère une erreur réseau', async () => {
    const { api, fetcher } = setup()
    fetcher.mockRejectedValue(new TypeError('Network error'))
    await expect(api.request('/auth/me')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Impossible de joindre'),
    })
  })
  it('gère une erreur serveur non JSON', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(
      new Response('<html>Error</html>', { status: 503 }),
    )
    await expect(api.request('/auth/me')).rejects.toMatchObject({
      status: 503,
      message: 'Le service est momentanément indisponible.',
    })
  })
  it('rejette une réponse de succès illisible', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(new Response('not-json'))
    await expect(api.request('/auth/me')).rejects.toBeInstanceOf(ApiError)
  })
  it('accepte une réponse sans contenu', async () => {
    const { api, fetcher } = setup()
    fetcher.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(api.request('/example')).resolves.toBeUndefined()
  })
  it('ne transforme pas une annulation en erreur réseau ou déconnexion', async () => {
    const { api, fetcher, onUnauthorized } = setup()
    fetcher.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(api.request('/auth/me')).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('refuse d’envoyer un token vers une URL externe', async () => {
    const { api, fetcher } = setup()
    await expect(api.request('https://external.example')).rejects.toThrow(
      'Chemin API relatif',
    )
    await expect(api.request('//external.example')).rejects.toThrow(
      'Chemin API relatif',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuse une requête privée sans token avant tout accès réseau', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const api = createApiClient({
      getToken: () => null,
      onUnauthorized: vi.fn(),
    })
    await expect(api.request('/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('URL API', () => {
  it('normalise les slashs finaux et conserve un éventuel préfixe', () => {
    expect(normalizeApiUrl('https://example.test/api/')).toBe(
      'https://example.test/api',
    )
  })
  it.each([
    'invalid',
    'ftp://example.test',
    'https://user:pass@example.test',
    'https://example.test?token=value',
    'https://example.test#secret',
  ])('rejette %s', (url) => {
    expect(() => normalizeApiUrl(url)).toThrow()
  })
})
