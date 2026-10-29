import { useEffect, useState } from 'react'
import { ApiError, isAbortError } from '../api/client'

export function useSampleQuery<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{
    data?: T
    error?: string
    load?: typeof load
    attempt?: number
  }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, load, attempt })
      },
      (error) => {
        if (!controller.signal.aborted && !isAbortError(error))
          setState({
            load,
            attempt,
            error:
              error instanceof ApiError
                ? error.message
                : 'Impossible de charger les échantillons.',
          })
      },
    )
    return () => controller.abort()
  }, [load, attempt])
  const current = state.load === load && state.attempt === attempt
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current,
    retry: () => setAttempt((value) => value + 1),
  }
}
