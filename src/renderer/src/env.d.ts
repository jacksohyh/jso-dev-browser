/// <reference types="vite/client" />
import type { DevBrowserApi } from '../../preload/index'

declare global {
  interface Window {
    devb: DevBrowserApi
  }
}

export {}
