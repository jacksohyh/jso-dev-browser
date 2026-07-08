import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('devb', { ping: () => 'pong' })
