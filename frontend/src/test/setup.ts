import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// Profile restoration precedes business requests; keep async waits bounded on shared CI.
configure({ asyncUtilTimeout: 3000 })
