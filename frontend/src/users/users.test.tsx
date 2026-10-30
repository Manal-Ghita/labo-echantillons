import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { SESSION_KEY } from '../auth/session'

const admin = {
  id: 'c154ee0f-8739-42cd-99bd-ce28e491ed90',
  name: 'Alex Responsable',
  email: 'alex@example.test',
  role: 'ADMIN',
  createdAt: '2026-10-29T08:00:00Z',
  isActive: true,
}
const researcher = {
  ...admin,
  id: 'c154ee0f-8739-42cd-99bd-ce28e491ed91',
  name: 'Sam Recherche',
  email: 'sam@example.test',
  role: 'RESEARCHER',
  isActive: true,
}
let accounts: (typeof admin)[]
let getAccounts: (() => Promise<Response>) | undefined
let post: ReturnType<
  typeof vi.fn<(body: Record<string, string>) => Promise<Response>>
>
let fetcher: ReturnType<typeof vi.fn>
let patch: ReturnType<
  typeof vi.fn<(id: string, isActive: boolean) => Promise<Response>>
>
function open() {
  render(
    <MemoryRouter initialEntries={['/users']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
async function form() {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Ajouter un chercheur' }),
  )
  await user.type(screen.getByLabelText('Nom complet *'), 'Nouveau membre')
  await user.type(screen.getByLabelText('Adresse e-mail *'), 'new@example.test')
  return user
}
beforeEach(() => {
  accounts = [admin, researcher]
  getAccounts = undefined
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'users-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  post = vi.fn(async (body) => {
    const created = { ...researcher, name: body.name, email: body.email }
    accounts = [...accounts, created]
    return Response.json(created, { status: 201 })
  })
  patch = vi.fn(async (id, isActive) => {
    accounts = accounts.map((account) =>
      account.id === id ? { ...account, isActive } : account,
    )
    return Response.json(accounts.find((account) => account.id === id))
  })
  fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/auth/me')) return Response.json(admin)
    if (url.endsWith('/status'))
      return patch(
        decodeURIComponent(url.split('/').at(-2)!),
        JSON.parse(options.body as string).isActive,
      )
    if (url.endsWith('/users')) {
      if (options.method === 'POST')
        return post(JSON.parse(options.body as string))
      return getAccounts ? getAccounts() : Response.json(accounts)
    }
    throw new Error('Unexpected API request')
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Administration des comptes', () => {
  it('reconnaît le compte actuel uniquement par son UUID, même si les noms et emails sont identiques', async () => {
    accounts = [
      { ...admin, name: 'Nom affiché différent' },
      { ...researcher, name: admin.name, email: admin.email },
    ]
    open()
    const rows = within(await screen.findByRole('table')).getAllByRole('row')
    expect(within(rows[1]).getByText('Compte actuel')).toBeVisible()
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(
      within(rows[2]).getByRole('button', {
        name: `Actions pour ${admin.name}`,
      }),
    ).toBeVisible()
    expect(within(rows[2]).queryByText('Compte actuel')).not.toBeInTheDocument()
  })
  it('ouvre le menu au clavier, le ferme par Échap/clic extérieur et rend le focus sans modifier de compte', async () => {
    open()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', {
      name: `Actions pour ${researcher.name}`,
    })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Désactiver' })).toHaveFocus()
    expect(screen.getByRole('menu').parentElement).toBe(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(
      screen.getByPlaceholderText('Rechercher par nom ou e-mail…'),
    )
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Rechercher par nom ou e-mail…'),
    ).toHaveFocus()
    expect(patch).not.toHaveBeenCalled()
  })
  it('interdit l’auto-désactivation et confirme celle d’un autre compte, puis permet la réactivation', async () => {
    open()
    const user = userEvent.setup()
    const table = await screen.findByRole('table')
    const own = within(table)
      .getByRole('rowheader', { name: admin.name })
      .closest('tr')!
    expect(within(own).getByText('Compte actuel')).toBeVisible()
    expect(within(own).queryByRole('button')).not.toBeInTheDocument()
    let row = within(table)
      .getByRole('rowheader', { name: researcher.name })
      .closest('tr')!
    await user.click(
      within(row).getByRole('button', {
        name: `Actions pour ${researcher.name}`,
      }),
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('menuitem', { name: 'Désactiver' }))
    expect(patch).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(
      within(row).getByRole('button', {
        name: `Actions pour ${researcher.name}`,
      }),
    )
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('menuitem', { name: 'Désactiver' }))
    expect(patch).toHaveBeenCalledWith(researcher.id, false)
    row = (
      await screen.findByRole('rowheader', { name: researcher.name })
    ).closest('tr')!
    expect(within(row).getByText('Désactivé')).toBeVisible()
    await waitFor(() =>
      expect(
        within(row).getByRole('button', {
          name: `Actions pour ${researcher.name}`,
        }),
      ).toHaveFocus(),
    )
    await user.click(
      within(row).getByRole('button', {
        name: `Actions pour ${researcher.name}`,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Réactiver' }))
    row = (
      await screen.findByRole('rowheader', { name: researcher.name })
    ).closest('tr')!
    expect(within(row).getByText('Actif')).toBeVisible()
    expect(confirm).toHaveBeenCalledTimes(2)
  })
  it.each([403, 404, 409])(
    'gère le refus de statut %s sans modifier la liste',
    async (status) => {
      patch.mockResolvedValue(Response.json({ message: 'Refus' }, { status }))
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      open()
      const user = userEvent.setup()
      const row = (
        await screen.findByRole('rowheader', { name: researcher.name })
      ).closest('tr')!
      await user.click(
        within(row).getByRole('button', {
          name: `Actions pour ${researcher.name}`,
        }),
      )
      await user.click(screen.getByRole('menuitem', { name: 'Désactiver' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 403
          ? 'autorisé'
          : status === 404
            ? 'introuvable'
            : 'administrateur',
      )
      expect(within(row).getByText('Actif')).toBeVisible()
    },
  )
  it('efface la session sur 401 pendant un changement d’état', async () => {
    patch.mockResolvedValue(Response.json({}, { status: 401 }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    open()
    const user = userEvent.setup()
    const row = (
      await screen.findByRole('rowheader', { name: researcher.name })
    ).closest('tr')!
    await user.click(
      within(row).getByRole('button', {
        name: `Actions pour ${researcher.name}`,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Désactiver' }))
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeVisible()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('filtre localement noms et emails sans casse ni accents et actualise le compteur', async () => {
    accounts = [
      admin,
      {
        ...researcher,
        name: 'Élodie Noël',
        email: 'recherche.ete@example.test',
      },
    ]
    open()
    expect(await screen.findByText('2 comptes')).toBeVisible()
    expect(screen.getByRole('table').querySelector('caption')).toBeNull()
    const user = userEvent.setup()
    const search = screen.getByPlaceholderText('Rechercher par nom ou e-mail…')
    await user.type(search, 'ELODIE NOEL')
    expect(screen.getByText('1 résultat sur 2 comptes')).toBeVisible()
    expect(screen.getByRole('rowheader', { name: 'Élodie Noël' })).toBeVisible()
    expect(
      screen.queryByRole('rowheader', { name: admin.name }),
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'RECHERCHE.ÉTÉ@EXAMPLE.TEST')
    expect(screen.getByText('1 résultat sur 2 comptes')).toBeVisible()
    await user.clear(search)
    await user.type(search, 'introuvable')
    expect(screen.getByText('0 résultat sur 2 comptes')).toBeVisible()
    expect(
      screen.getByText('Aucun compte ne correspond à votre recherche.'),
    ).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByText('2 comptes')).toBeVisible()
    expect(screen.getByRole('table')).toBeVisible()
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/users')),
    ).toHaveLength(1)
  })
  it('affiche un tableau de champs publics, rôles français et dates réelles sans UUID', async () => {
    open()
    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Nom', 'Email', 'Rôle', 'État', 'Date de création', 'Actions'])
    expect(within(table).getByText('Chercheur')).toBeVisible()
    expect(within(table).getByText('Administrateur')).toBeVisible()
    expect(within(table).getByText(researcher.email)).toBeVisible()
    expect(table.querySelector('time')).toHaveAttribute(
      'datetime',
      admin.createdAt,
    )
    expect(document.body).not.toHaveTextContent(admin.id)
    expect(document.body).not.toHaveTextContent(researcher.id)
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
  it('affiche chargement puis état vide', async () => {
    let resolve!: (response: Response) => void
    getAccounts = () =>
      new Promise((done) => {
        resolve = done
      })
    open()
    expect(await screen.findByText('Chargement des comptes…')).toBeVisible()
    await act(async () => resolve(Response.json([])))
    expect(await screen.findByText('Aucun compte à afficher.')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
  it('permet de réessayer la liste après une panne réseau', async () => {
    getAccounts = async () => {
      throw new TypeError('Offline')
    }
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    getAccounts = undefined
    await userEvent.click(
      screen.getByRole('button', { name: 'Réessayer les comptes' }),
    )
    expect(await screen.findByRole('table')).toBeVisible()
  })
  it('bascule la visibilité sans changer le mot de passe et confirme une fermeture sale', async () => {
    open()
    const user = await form()
    const password = screen.getByLabelText('Mot de passe initial *')
    await user.type(password, 'fake-password-42')
    await user.click(
      screen.getByRole('button', { name: 'Afficher le mot de passe' }),
    )
    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('fake-password-42')
    await user.click(
      screen.getByRole('button', { name: 'Masquer le mot de passe' }),
    )
    expect(password).toHaveAttribute('type', 'password')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(password).toHaveValue('fake-password-42')
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ajouter un chercheur' }),
    ).toHaveFocus()
    expect(post).not.toHaveBeenCalled()
  })
  it.each(['short', '😀'.repeat(6), 'é'.repeat(37)])(
    'refuse un mot de passe incompatible sans requête',
    async (password) => {
      open()
      const user = await form()
      await user.click(screen.getByLabelText('Mot de passe initial *'))
      await user.paste(password)
      await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
      expect(await screen.findByRole('alert')).toHaveFocus()
      expect(screen.getByLabelText('Mot de passe initial *')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      expect(
        screen.getByLabelText('Mot de passe initial *'),
      ).toHaveAccessibleDescription(
        password === 'é'.repeat(37) ? /72 octets UTF-8/ : /12 caractères/,
      )
      expect(post).not.toHaveBeenCalled()
    },
  )
  it.each(['é'.repeat(36), '😀'.repeat(12)])(
    'accepte les limites Unicode valides et actualise la liste après création',
    async (password) => {
      open()
      const user = await form()
      await user.click(screen.getByLabelText('Mot de passe initial *'))
      await user.paste(password)
      await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
      expect(await screen.findByText('Compte chercheur créé.')).toBeVisible()
      expect(post).toHaveBeenCalledWith({
        name: 'Nouveau membre',
        email: 'new@example.test',
        password,
      })
      expect(
        await screen.findByRole('rowheader', { name: 'Nouveau membre' }),
      ).toBeVisible()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )
  it('bloque les doubles soumissions et la fermeture pendant la requête', async () => {
    let resolve!: (response: Response) => void
    post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    open()
    const user = await form()
    await user.type(
      screen.getByLabelText('Mot de passe initial *'),
      'fake-password-42',
    )
    const submit = screen.getByRole('button', { name: 'Créer le compte' })
    await user.dblClick(submit)
    expect(post).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'Création en cours…' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Fermer le panneau' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled()
    await act(async () => resolve(Response.json(researcher, { status: 201 })))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })
  it('affiche un conflit email explicite et efface le mot de passe après refus', async () => {
    post.mockResolvedValue(
      Response.json({ message: 'Already used' }, { status: 409 }),
    )
    open()
    const user = await form()
    await user.type(
      screen.getByLabelText('Mot de passe initial *'),
      'fake-password-42',
    )
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cet email est déjà utilisé.',
    )
    expect(screen.getByLabelText('Mot de passe initial *')).toHaveValue('')
    expect(screen.getByLabelText('Adresse e-mail *')).toHaveValue(
      'new@example.test',
    )
  })
})
