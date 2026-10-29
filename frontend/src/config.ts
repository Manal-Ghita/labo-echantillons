export function normalizeApiUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_API_URL doit être une URL HTTP(S).')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'VITE_API_URL doit être une URL HTTP(S) sans identifiants, paramètres ou fragment.',
    )
  }
  return url.toString().replace(/\/+$/, '')
}

export const API_URL = normalizeApiUrl(
  import.meta.env.VITE_API_URL || 'http://localhost:3000',
)
