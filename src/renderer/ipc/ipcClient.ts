/** Typed access to the preload-exposed API. */
import type { ApiSurface } from '@shared/index'

declare global {
  interface Window {
    api: ApiSurface
  }
}

export const api: ApiSurface = window.api
