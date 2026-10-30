import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import type { UserProfile } from '../auth/types'
import { formatDate } from '../samples/api'
import { useSampleQuery } from '../samples/useSampleQuery'
import { CreateResearcherPanel } from './CreateResearcherPanel'
import './users.css'
import { UserStatusAction } from './UserStatusAction'

function searchText(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr')
}

export function UsersPage() {
  const { api } = useAuth()
  const load = useCallback(
    (signal: AbortSignal) => api.request<UserProfile[]>('/users', { signal }),
    [api],
  )
  const users = useSampleQuery(load)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState(false)
  const [search, setSearch] = useState('')
  const term = searchText(search.trim())
  const filtered = users.data?.filter(
    (user) =>
      searchText(user.name).includes(term) ||
      searchText(user.email).includes(term),
  )
  const opener = useRef<HTMLButtonElement>(null)
  const actionFocus = useRef<string | null>(null)
  useEffect(() => {
    if (users.data && actionFocus.current) {
      document
        .getElementById(`account-action-${actionFocus.current}`)
        ?.focus({ preventScroll: true })
      actionFocus.current = null
    }
  }, [users.data])
  return (
    <section className="page users-page">
      <div className="page-heading">
        <div>
          <h1>Comptes du laboratoire</h1>
          <p className="muted">Gérer les membres du laboratoire.</p>
        </div>
        <button
          ref={opener}
          className="button button-primary"
          aria-expanded={adding}
          aria-controls="researcher-panel"
          onClick={() => {
            setNotice(false)
            setAdding(true)
          }}
        >
          Ajouter un chercheur
        </button>
      </div>
      {notice && (
        <p className="success-notice" role="status">
          Compte chercheur créé.
        </p>
      )}
      <div
        className="field users-search"
        role="search"
        aria-label="Recherche des comptes"
      >
        <label htmlFor="users-search">Nom ou adresse e-mail</label>
        <input
          id="users-search"
          type="search"
          value={search}
          placeholder="Rechercher par nom ou e-mail…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {users.loading && <p role="status">Chargement des comptes…</p>}
      {users.error && (
        <div>
          <p role="alert" className="alert">
            {users.error}
          </p>
          <button className="button button-secondary" onClick={users.retry}>
            Réessayer les comptes
          </button>
        </div>
      )}
      {users.data && (
        <p className="muted" role="status">
          {term
            ? `${filtered?.length ?? 0} ${(filtered?.length ?? 0) > 1 ? 'résultats' : 'résultat'} sur ${users.data.length} ${users.data.length > 1 ? 'comptes' : 'compte'}`
            : `${users.data.length} ${users.data.length > 1 ? 'comptes' : 'compte'}`}
        </p>
      )}
      {filtered?.length === 0 && (
        <p className="sample-panel">
          {term
            ? 'Aucun compte ne correspond à votre recherche.'
            : 'Aucun compte à afficher.'}
        </p>
      )}
      {!!filtered?.length && (
        <div
          className="users-table-region"
          role="region"
          aria-label="Membres du laboratoire"
          tabIndex={0}
        >
          <table className="users-table" aria-label="Comptes du laboratoire">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Email</th>
                <th scope="col">Rôle</th>
                <th scope="col">État</th>
                <th scope="col">Date de création</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <th scope="row">{user.name}</th>
                  <td>{user.email}</td>
                  <td>
                    <span className="status-tag">
                      {user.role === 'ADMIN' ? 'Administrateur' : 'Chercheur'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-tag ${user.isActive ? '' : 'status-warning'}`}
                    >
                      {user.isActive ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                  <td>
                    <time dateTime={user.createdAt}>
                      {formatDate(user.createdAt)}
                    </time>
                  </td>
                  <td>
                    <UserStatusAction
                      account={user}
                      onUpdated={() => {
                        actionFocus.current = user.id
                        users.retry()
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <CreateResearcherPanel
          openerRef={opener}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false)
            setNotice(true)
            users.retry()
          }}
        />
      )}
    </section>
  )
}
