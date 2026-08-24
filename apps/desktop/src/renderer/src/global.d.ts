import type { RevyApi } from '../../shared/contracts.js'

declare global {
  interface Window {
    revy: RevyApi
  }
}
