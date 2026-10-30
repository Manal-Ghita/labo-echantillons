import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { useAuth } from '../auth/context'
import { OperatorSelect } from './OperatorSelect'

const profile = {
  id: '87da980d-d334-48ae-9a09-bdd68a1feaa8',
  name: 'Alex Test',
  email: 'private@example.test',
  role: 'RESEARCHER', isActive: true,
  createdAt: '2026-10-30T08:00:00Z',
}
const other = {
  id: '8b717a1a-629e-4871-935b-7f4d60976772',
  name: 'Élodie Martin',
}
let fetcher: ReturnType<typeof vi.fn>
let load: () => Promise<Response>
let role: string
function Picker() {
  const { user } = useAuth()
  const [value, setValue] = useState(user?.id ?? '')
  return (
    <>
      <OperatorSelect value={value} onChange={setValue} disabled={false} />
      <output aria-label="Identifiant sélectionné">{value}</output>
    </>
  )
}
function Ready() {
  const { user } = useAuth()
  return user ? <Picker /> : null
}
function open() {
  render(
    <AuthProvider>
      <Ready />
    </AuthProvider>,
  )
}
beforeEach(() => {
  sessionStorage.setItem(
    'labo.session',
    JSON.stringify({
      token: 'operator-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  role = 'RESEARCHER'
  load = () =>
    Promise.resolve(
      Response.json([{ id: profile.id, name: profile.name }, other]),
    )
  fetcher = vi.fn((url: string) =>
    url.endsWith('/auth/me')
      ? Promise.resolve(Response.json({ ...profile, role }))
      : load(),
  )
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

it.each(['ADMIN', 'RESEARCHER'])(
  'propose Moi avec l’identifiant réel pour %s, sans lire GET /users',
  async (nextRole) => {
    role = nextRole
    open()
    const option = await screen.findByRole('option', {
      name: 'Moi — Alex Test',
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Opérateur réel')).toBeEnabled(),
    )
    expect(option).toHaveValue(profile.id)
    expect(screen.getByLabelText('Opérateur réel')).toHaveValue(profile.id)
    expect(screen.queryByText(profile.email)).not.toBeInTheDocument()
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith('/users/operators')),
    ).toHaveLength(1)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/users'))).toBe(
      false,
    )
  },
)
it('recherche par nom sans perdre la sélection puis choisit une autre identité réelle', async () => {
  open()
  const user = userEvent.setup()
  await screen.findByRole('option', { name: other.name })
  await user.type(
    screen.getByLabelText('Rechercher un opérateur par nom'),
    'elodie',
  )
  await user.selectOptions(screen.getByLabelText('Opérateur réel'), other.id)
  expect(screen.getByLabelText('Identifiant sélectionné')).toHaveTextContent(
    other.id,
  )
  await user.clear(screen.getByLabelText('Rechercher un opérateur par nom'))
  await user.type(
    screen.getByLabelText('Rechercher un opérateur par nom'),
    'inexistant',
  )
  expect(screen.getByText(/Aucun nom correspondant/)).toBeVisible()
  expect(screen.getByLabelText('Opérateur réel')).toHaveValue(other.id)
  await user.selectOptions(screen.getByLabelText('Opérateur réel'), '')
  expect(screen.getByLabelText('Identifiant sélectionné')).toHaveTextContent('')
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith('/users/operators')),
  ).toHaveLength(1)
})
it('signale le chargement sans inventer d’autres personnes', async () => {
  let finish!: (response: Response) => void
  load = () =>
    new Promise<Response>((resolve) => {
      finish = resolve
    })
  open()
  expect(await screen.findByText('Chargement des opérateurs…')).toBeVisible()
  expect(screen.getByLabelText('Opérateur réel')).toBeDisabled()
  // The loading label can render before the effect starts the deferred fetch.
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  await act(async () =>
    finish(Response.json([{ id: profile.id, name: profile.name }])),
  )
  expect(screen.getByLabelText('Opérateur réel')).toBeEnabled()
  expect(screen.getByLabelText('Opérateur réel')).toHaveValue(profile.id)
})
it('gère une liste vide en conservant le caractère facultatif de l’opérateur', async () => {
  load = () => Promise.resolve(Response.json([]))
  open()
  expect(await screen.findByText(/Aucun opérateur disponible/)).toBeVisible()
  await waitFor(() =>
    expect(screen.getByLabelText('Identifiant sélectionné')).toHaveTextContent(
      '',
    ),
  )
  expect(screen.getByLabelText('Opérateur réel')).toBeDisabled()
  expect(screen.queryByRole('option', { name: /Moi/ })).not.toBeInTheDocument()
})
it('affiche une erreur réseau et permet de recharger la liste', async () => {
  load = () => Promise.reject(new TypeError('Network unavailable'))
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Impossible de charger les opérateurs.',
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Identifiant sélectionné')).toHaveTextContent(
      '',
    ),
  )
  load = () =>
    Promise.resolve(
      Response.json([{ id: profile.id, name: profile.name }, other]),
    )
  await userEvent.click(
    screen.getByRole('button', { name: 'Réessayer les opérateurs' }),
  )
  await screen.findByRole('option', { name: other.name })
  await userEvent.selectOptions(
    screen.getByLabelText('Opérateur réel'),
    other.id,
  )
  expect(screen.getByLabelText('Opérateur réel')).toHaveValue(other.id)
})
