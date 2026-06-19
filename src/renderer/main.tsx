import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { IpcProvider } from './providers/IpcProvider'
import './styles/tailwind.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root not found')

createRoot(container).render(
  <StrictMode>
    <IpcProvider>
      <App />
    </IpcProvider>
  </StrictMode>
)
