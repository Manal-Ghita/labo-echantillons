import { API_URL, normalizeApiUrl } from '../config'

export class ApiError extends Error {
  readonly status: number
  readonly details: string[]
  constructor(status: number, message: string, details: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

type RequestOptions = Omit<RequestInit, 'body' | 'credentials'> & {
  body?: unknown
  authenticated?: boolean
  responseType?: 'json' | 'blob'
}
type ClientOptions = {
  baseUrl?: string
  initialToken?: string | null
  getToken?: () => string | null
  onUnauthorized: (token: string) => void
}
export type ApiClient = ReturnType<typeof createApiClient>
export const isAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'AbortError'

export function createApiClient(options: ClientOptions) {
  const baseUrl = normalizeApiUrl(options.baseUrl || API_URL)
  let currentToken = options.initialToken ?? null
  let onUnauthorized = options.onUnauthorized
  const getToken = () => (options.getToken ? options.getToken() : currentToken)
  return {
    getToken,
    setToken(value: string | null) {
      currentToken = value
    },
    setUnauthorizedHandler(handler: (token: string) => void) {
      onUnauthorized = handler
    },
    async request<T>(
      path: string,
      optionsForRequest: RequestOptions = {},
    ): Promise<T> {
      if (!path.startsWith('/') || path.startsWith('//'))
        throw new Error('Chemin API relatif attendu.')
      const {
        body,
        authenticated = true,
        responseType = 'json',
        headers: customHeaders,
        ...init
      } = optionsForRequest
      const token = authenticated ? getToken() : null
      if (authenticated && !token)
        throw new ApiError(401, 'Veuillez vous connecter.')
      const headers = new Headers(customHeaders)
      headers.delete('Authorization')
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const multipart = body instanceof FormData
      if (multipart) headers.delete('Content-Type')
      else if (body !== undefined)
        headers.set('Content-Type', 'application/json')
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers,
          body: multipart
            ? body
            : body === undefined
              ? undefined
              : JSON.stringify(body),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        })
        if (response.ok && responseType === 'blob') {
          const blob = await response.blob()
          if (init.signal?.aborted)
            throw new DOMException('Requête annulée.', 'AbortError')
          return blob as T
        }
        const text = await response.text()
        if (init.signal?.aborted)
          throw new DOMException('Requête annulée.', 'AbortError')
        let payload: unknown
        try {
          payload = text ? JSON.parse(text) : undefined
        } catch {
          payload = undefined
        }
        if (!response.ok) {
          const message =
            typeof payload === 'object' &&
            payload !== null &&
            'message' in payload
              ? payload.message
              : undefined
          const details = Array.isArray(message)
            ? message.filter((item): item is string => typeof item === 'string')
            : []
          let userMessage = 'La requête a échoué. Veuillez réessayer.'
          if (response.status === 401)
            userMessage = authenticated
              ? 'Votre session a expiré. Veuillez vous reconnecter.'
              : 'Email ou mot de passe incorrect.'
          else if (response.status === 403)
            userMessage =
              'Vous n’avez pas les droits nécessaires pour cette action.'
          else if (response.status === 400)
            userMessage = 'Veuillez vérifier les champs du formulaire.'
          else if (response.status === 413)
            userMessage = 'Le fichier dépasse la taille maximale autorisée.'
          else if (response.status === 415)
            userMessage =
              'Format de fichier refusé. Utilisez un fichier JPEG, PNG, PDF ou CSV UTF-8 valide.'
          else if (response.status >= 500)
            userMessage = 'Le service est momentanément indisponible.'
          else if (typeof message === 'string') userMessage = message
          if (response.status === 401 && token) onUnauthorized(token)
          throw new ApiError(response.status, userMessage, details)
        }
        if (response.status !== 204 && payload === undefined)
          throw new ApiError(0, 'Le serveur a renvoyé une réponse illisible.')
        return payload as T
      } catch (error) {
        if (error instanceof ApiError || isAbortError(error)) throw error
        throw new ApiError(
          0,
          'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
        )
      }
    },
  }
}
