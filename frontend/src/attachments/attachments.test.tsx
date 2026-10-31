import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Attachments } from './Attachments'
import { AuthContext, type AuthContextValue } from '../auth/context'
import { createApiClient } from '../api/client'

const metadata = {
  id: 'file-id',
  originalName: 'mesures.csv',
  mimeType: 'text/csv',
  size: 42,
  createdAt: '2026-10-31T10:00:00Z',
  createdBy: { id: 'owner', name: 'Karim Test' },
}
let calls: { path: string; options: RequestInit }[],
  files: (typeof metadata)[],
  failure: number
const unauthorized = vi.fn()
beforeEach(() => {
  calls = []
  files = []
  failure = 0
  unauthorized.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname
      calls.push({ path, options })
      if (failure)
        return Response.json({ message: 'Refus' }, { status: failure })
      if (path.endsWith('/download'))
        return new Response('time,value\n0,150\n', {
          headers: { 'content-type': 'text/csv' },
        })
      if (options.method === 'POST') {
        files.push(metadata)
        return Response.json(metadata, { status: 201 })
      }
      return Response.json(files)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())
function setup(authorized = true, stepId?: string) {
  const api = createApiClient({
    initialToken: 'mock-token',
    onUnauthorized: unauthorized,
    baseUrl: 'http://localhost:3000',
  })
  const auth = {
    api,
    user: { id: 'owner', role: 'RESEARCHER' },
  } as AuthContextValue
  render(
    <AuthContext.Provider value={auth}>
      <Attachments
        sampleId="sample-id"
        stepId={stepId}
        authorized={authorized}
      />
    </AuthContext.Provider>,
  )
  return userEvent.setup()
}
it('loads lazily, displays empty state, uploads multipart then refreshes exact list', async () => {
  const user = setup()
  expect(calls).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  expect(await screen.findByText('Aucun fichier associé.')).toBeInTheDocument()
  await user.upload(
    screen.getByLabelText('Ajouter un fichier'),
    new File(['time,value\n0,150.125\n'], 'mesures.csv', { type: 'text/csv' }),
  )
  await user.click(screen.getByRole('button', { name: 'Ajouter le fichier' }))
  expect(await screen.findByText('mesures.csv')).toBeInTheDocument()
  const uploaded = calls.find((call) => call.options.method === 'POST')!
  expect(uploaded.path).toBe('/samples/sample-id/files')
  expect(uploaded.options.body).toBeInstanceOf(FormData)
  const body = uploaded.options.body as FormData
  expect(Array.from(body.keys())).toEqual(['file'])
  expect((body.get('file') as File).name).toBe('mesures.csv')
  expect((uploaded.options.headers as Headers).get('Authorization')).toBe(
    'Bearer mock-token',
  )
  expect((uploaded.options.headers as Headers).has('Content-Type')).toBe(false)
  expect(screen.getByText(/Karim Test/)).toBeInTheDocument()
})
it('does not offer upload to another researcher; step list uses its own association', async () => {
  files = [metadata]
  const user = setup(false, 'step-id')
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  expect(await screen.findByText('mesures.csv')).toBeInTheDocument()
  expect(screen.queryByLabelText('Ajouter un fichier')).not.toBeInTheDocument()
  expect(calls[0].path).toBe('/samples/sample-id/steps/step-id/files')
})
it('prevents duplicate submissions and preserves an upload when hiding/reopening files', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options: RequestInit = {}) => {
      calls.push({ path: new URL(url).pathname, options })
      if (options.method === 'POST')
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      return Promise.resolve(Response.json(files))
    }),
  )
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  await user.upload(
    screen.getByLabelText('Ajouter un fichier'),
    new File(['a,b\n1,2'], 'mesures.csv', { type: 'text/csv' }),
  )
  await user.dblClick(
    screen.getByRole('button', { name: 'Ajouter le fichier' }),
  )
  expect(calls.filter((call) => call.options.method === 'POST')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Masquer les fichiers' }))
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  expect(screen.getByRole('button', { name: 'Envoi en cours…' })).toBeDisabled()
  files = [metadata]
  finish(Response.json(metadata, { status: 201 }))
  expect(await screen.findByText('Fichier ajouté.')).toBeInTheDocument()
})
it('requires a selected file and displays server format/size errors', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  await user.click(screen.getByRole('button', { name: 'Ajouter le fichier' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choisissez un fichier.')
  await user.upload(
    screen.getByLabelText('Ajouter un fichier'),
    new File(['bad'], 'fake.png', { type: 'image/png' }),
  )
  failure = 415
  await user.click(screen.getByRole('button', { name: 'Ajouter le fichier' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Format de fichier refusé',
  )
  failure = 413
  await user.click(screen.getByRole('button', { name: 'Ajouter le fichier' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('taille maximale')
})
it.each([401, 403, 404, 500])(
  'handles list HTTP %s without exposing storage data',
  async (status) => {
    failure = status
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Réessayer les fichiers' }),
    ).toBeInTheDocument()
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
  },
)
it('downloads with JWT through a blob URL, never a public storage link', async () => {
  files = [metadata]
  const create = vi.fn(() => 'blob:authenticated-file'),
    revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    },
  )
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Photos et fichiers' }))
  await user.click(await screen.findByRole('button', { name: 'Télécharger' }))
  await waitFor(() => expect(create).toHaveBeenCalled())
  const call = calls.find((item) => item.path.endsWith('/download'))!
  expect((call.options.headers as Headers).get('Authorization')).toBe(
    'Bearer mock-token',
  )
  expect(click).toHaveBeenCalledTimes(1)
  click.mockRestore()
})
