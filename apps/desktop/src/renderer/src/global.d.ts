import type { ShippyApi } from '../../shared/contracts.js'

declare global {
  interface Window {
    shippy: ShippyApi
  }
}
