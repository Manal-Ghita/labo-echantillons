import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { SESSION_KEY } from '../auth/session'

const profile = {
  id: 'owner-id',
  name: 'Camille',
  email: 'camille@example.test',
  role: 'RESEARCHER',
  createdAt: '2026-10-29T08:00:00Z',
}
const sample = {
  id: '87da980d-d334-48ae-9a09-bdd68a1feaa8',
  reference: 'K24-017',
  name: 'Silicium',
  description: 'Dépôt initial',
  creatorId: profile.id,
  status: null,
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T09:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
let business: ReturnType<
  typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>
>
let fetcher: ReturnType<typeof vi.fn>
function open(path = '/samples') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'sample-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  business = vi.fn(async (url: string, options: RequestInit) =>
    Response.json(
      options.method === 'POST' || url.includes(sample.id) ? sample : [sample],
    ),
  )
  fetcher = vi.fn((url: string, options: RequestInit) =>
    url.endsWith('/auth/me')
      ? Promise.resolve(Response.json(profile))
      : url.endsWith('/steps')
        ? Promise.resolve(Response.json([]))
        : business(url, options),
  )
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('Gestion des échantillons via le client HTTP authentifié', () => {
  it('charge la liste et ouvre le détail avec les champs réellement exposés', async () => {
    open()
    await userEvent.click(await screen.findByRole('link', { name: 'Silicium' }))
    expect(
      await screen.findByRole('heading', { name: 'Silicium' }),
    ).toBeVisible()
    expect(screen.getByText(`${profile.id} (vous)`)).toBeVisible()
    expect(screen.getByText(sample.id)).toBeVisible()
    expect(screen.getAllByText('Non renseigné')).toHaveLength(2)
    expect(screen.getByText('Dépôt initial')).toBeVisible()
    expect(business.mock.calls[0][1].headers).toBeInstanceOf(Headers)
    expect(
      (business.mock.calls[0][1].headers as Headers).get('Authorization'),
    ).toBe('Bearer sample-test-token')
  })
  it('envoie q encodé, conserve la recherche dans URL et permet de l’effacer', async () => {
    open()
    const user = userEvent.setup()
    await user.type(
      await screen.findByLabelText('Référence ou nom'),
      ' K24 & silicium ',
    )
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() =>
      expect(business).toHaveBeenCalledWith(
        'http://localhost:3000/samples?q=K24+%26+silicium',
        expect.anything(),
      ),
    )
    await user.click(
      screen.getByRole('button', { name: 'Effacer la recherche' }),
    )
    expect(screen.getByLabelText('Référence ou nom')).toHaveValue('')
    await waitFor(() =>
      expect(business.mock.calls.at(-1)?.[0]).toBe(
        'http://localhost:3000/samples',
      ),
    )
  })
  it('initialise une recherche partagée par URL', async () => {
    open('/samples?q=K24-017')
    expect(await screen.findByLabelText('Référence ou nom')).toHaveValue(
      'K24-017',
    )
    await waitFor(() =>
      expect(business.mock.calls[0][0]).toContain('?q=K24-017'),
    )
  })
  it.each([
    ['/samples', 'Aucun échantillon'],
    ['/samples?q=inexistant', 'Aucun résultat'],
  ])('affiche un état vide pour %s', async (path, title) => {
    business.mockResolvedValue(Response.json([]))
    open(path)
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  })
  it('affiche le chargement et ignore une ancienne recherche après changement', async () => {
    let finish!: (response: Response) => void
    business.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    open()
    expect(
      await screen.findByText('Chargement des échantillons…'),
    ).toBeVisible()
    await userEvent.type(screen.getByLabelText('Référence ou nom'), 'nouveau')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    await screen.findByRole('link', { name: 'Silicium' })
    finish(Response.json([{ ...sample, name: 'Ancien résultat' }]))
    await waitFor(() =>
      expect(screen.queryByText('Ancien résultat')).not.toBeInTheDocument(),
    )
  })
  it('crée sans identité client puis ouvre le détail', async () => {
    open()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('link', { name: 'Créer un échantillon' }),
    )
    await user.type(screen.getByLabelText('Référence *'), ' K24-017 ')
    await user.type(screen.getByLabelText('Nom *'), ' Silicium ')
    await user.type(screen.getByLabelText('Description'), 'Dépôt initial')
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’échantillon' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Silicium' }),
    ).toBeVisible()
    const call = business.mock.calls.find(
      ([, options]) => options.method === 'POST',
    )!
    expect(call[0]).toBe('http://localhost:3000/samples')
    expect(JSON.parse(call[1].body as string)).toEqual({
      reference: 'K24-017',
      name: 'Silicium',
      description: 'Dépôt initial',
    })
  })
  it('omet la description facultative vide et bloque la double soumission', async () => {
    let finish!: (response: Response) => void
    business.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    open('/samples/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Référence *'), 'K24-017')
    await user.type(screen.getByLabelText('Nom *'), 'Silicium')
    await user.dblClick(
      screen.getByRole('button', { name: 'Enregistrer l’échantillon' }),
    )
    expect(business).toHaveBeenCalledTimes(1)
    expect(JSON.parse(business.mock.calls[0][1].body as string)).toEqual({
      reference: 'K24-017',
      name: 'Silicium',
    })
    expect(
      screen.getByRole('button', { name: 'Enregistrement…' }),
    ).toBeDisabled()
    finish(Response.json(sample, { status: 201 }))
    await screen.findByRole('heading', { name: 'Silicium' })
  })
  it('refuse les champs contenant uniquement des espaces', async () => {
    open('/samples/new')
    await userEvent.type(await screen.findByLabelText('Référence *'), '   ')
    await userEvent.type(screen.getByLabelText('Nom *'), '  ')
    await userEvent.click(
      screen.getByRole('button', { name: 'Enregistrer l’échantillon' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('obligatoires')
    expect(business).not.toHaveBeenCalled()
  })
  it.each([400, 403, 409])(
    'conserve le formulaire après une erreur %i',
    async (status) => {
      business.mockResolvedValue(
        Response.json(
          {
            message:
              status === 400
                ? ['name should not be empty']
                : 'Cette référence existe déjà.',
          },
          { status },
        ),
      )
      open('/samples/new')
      await userEvent.type(
        await screen.findByLabelText('Référence *'),
        sample.reference,
      )
      await userEvent.type(screen.getByLabelText('Nom *'), sample.name)
      await userEvent.click(
        screen.getByRole('button', { name: 'Enregistrer l’échantillon' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 403
          ? 'droits'
          : status === 400
            ? 'name should not be empty'
            : 'référence existe déjà',
      )
      expect(screen.getByLabelText('Référence *')).toHaveValue(sample.reference)
      expect(
        screen.getByRole('button', { name: 'Enregistrer l’échantillon' }),
      ).toBeEnabled()
    },
  )
  it('redirige une session expirée vers la connexion', async () => {
    business.mockResolvedValue(Response.json({}, { status: 401 }))
    open()
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeVisible()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('affiche un échantillon inexistant', async () => {
    business.mockResolvedValue(
      Response.json({ message: 'Échantillon introuvable.' }, { status: 404 }),
    )
    open(`/samples/${sample.id}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Échantillon introuvable.',
    )
  })
  it('permet de réessayer après une erreur réseau', async () => {
    business.mockRejectedValueOnce(new TypeError('Network error'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Silicium' })).toBeVisible()
  })
  it.each(['ACTIVE', 'ABANDONED'] as const)(
    'affiche le statut %s sans le modifier',
    async (status) => {
      business.mockResolvedValue(
        Response.json({ ...sample, status, creatorId: 'another-owner' }),
      )
      open(`/samples/${sample.id}`)
      expect(
        await screen.findByRole('heading', { name: 'Silicium' }),
      ).toBeVisible()
      expect(
        screen.getAllByText(status === 'ACTIVE' ? 'Actif' : 'Abandonné'),
      ).toHaveLength(2)
      expect(screen.getByText('another-owner')).toBeVisible()
    },
  )
})
