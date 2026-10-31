import { useCallback, useId, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import { ApiError } from '../api/client'
import { useSampleQuery } from '../samples/useSampleQuery'
import { formatDate } from '../samples/api'
import './attachments.css'

type Attachment = {
  id: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
  createdBy: { id: string; name: string }
}

export function Attachments({
  sampleId,
  stepId,
  authorized,
}: {
  sampleId: string
  stepId?: string
  authorized: boolean
}) {
  const [open, setOpen] = useState(false)
  const [requested, setRequested] = useState(false)
  const id = useId()
  return (
    <section className="attachments">
      <button
        type="button"
        className="button button-secondary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setRequested(true)
          setOpen(!open)
        }}
      >
        {open ? 'Masquer les fichiers' : 'Photos et fichiers'}
      </button>
      <div id={id} hidden={!open}>
        {requested && (
          <AttachmentContent
            sampleId={sampleId}
            stepId={stepId}
            authorized={authorized}
          />
        )}
      </div>
    </section>
  )
}

function AttachmentContent({
  sampleId,
  stepId,
  authorized,
}: {
  sampleId: string
  stepId?: string
  authorized: boolean
}) {
  const { api } = useAuth()
  const path = `/samples/${encodeURIComponent(sampleId)}${stepId ? `/steps/${encodeURIComponent(stepId)}` : ''}/files`
  const load = useCallback(
    (signal: AbortSignal) => api.request<Attachment[]>(path, { signal }),
    [api, path],
  )
  const files = useSampleQuery(load)
  const [selected, setSelected] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState(false)
  const pending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  async function upload() {
    if (pending.current) return
    setError(null)
    setNotice(false)
    if (!selected) {
      setError('Choisissez un fichier.')
      return
    }
    pending.current = true
    setBusy(true)
    const body = new FormData()
    body.append('file', selected)
    try {
      await api.request(path, { method: 'POST', body })
      setSelected(null)
      if (input.current) input.current.value = ''
      setNotice(true)
      files.retry()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Impossible d’ajouter ce fichier.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  async function download(file: Attachment) {
    setError(null)
    setDownloading(file.id)
    let url: string | undefined
    try {
      const blob = await api.request<Blob>(
        `/files/${encodeURIComponent(file.id)}/download`,
        { responseType: 'blob' },
      )
      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.originalName
      document.body.append(link)
      link.click()
      link.remove()
      // Give the browser time to consume the URL before releasing it.
      const downloadUrl = url
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      url = undefined
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Téléchargement impossible.',
      )
    } finally {
      if (url) URL.revokeObjectURL(url)
      setDownloading(null)
    }
  }
  return (
    <div className="attachments-content">
      <h4>
        {stepId ? 'Fichiers de cette étape' : 'Fichiers de l’échantillon'}
      </h4>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">Fichier ajouté.</p>}
      {files.loading && <p role="status">Chargement des fichiers…</p>}
      {files.error && (
        <div>
          <p role="alert">{files.error}</p>
          <button className="button button-secondary" onClick={files.retry}>
            Réessayer les fichiers
          </button>
        </div>
      )}
      {files.data?.length === 0 && (
        <p className="muted">Aucun fichier associé.</p>
      )}
      <ul className="attachment-list">
        {files.data?.map((file) => (
          <li key={file.id}>
            <div>
              <strong>{file.originalName}</strong>
              <small>
                {file.mimeType} ·{' '}
                {new Intl.NumberFormat('fr-FR').format(file.size)} octets ·{' '}
                {file.createdBy.name} · {formatDate(file.createdAt)}
              </small>
            </div>
            <button
              className="button button-secondary"
              disabled={downloading !== null}
              onClick={() => void download(file)}
            >
              {downloading === file.id ? 'Téléchargement…' : 'Télécharger'}
            </button>
          </li>
        ))}
      </ul>
      {authorized && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void upload()
          }}
          aria-busy={busy}
        >
          <div className="field">
            <label htmlFor={id}>Ajouter un fichier</label>
            <input
              ref={input}
              id={id}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.csv"
              disabled={busy}
              onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
            />
          </div>
          <p className="muted">
            JPEG, PNG, PDF ou CSV UTF-8. Limite initiale : 10 Mo par fichier ;
            le serveur applique la limite configurée.
          </p>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Envoi en cours…' : 'Ajouter le fichier'}
          </button>
        </form>
      )}
    </div>
  )
}
