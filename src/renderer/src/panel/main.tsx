import { createRoot } from 'react-dom/client'
import { Panel } from './Panel'
import './styles.css'

const params = new URLSearchParams(location.search)
const tabId = params.get('tabId') ?? ''
const capturing = params.get('capturing') !== 'false'

createRoot(document.getElementById('root')!).render(<Panel tabId={tabId} initialCapturing={capturing} />)
