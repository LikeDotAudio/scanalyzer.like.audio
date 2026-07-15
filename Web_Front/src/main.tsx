import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupInstallPrompt } from './installPrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Progressive Web App: offer the install prompt, and register the service worker so the app
// is installable and runs offline. Only on the web build (not the Tauri desktop app, which
// is already native) and only in a production build (a SW would fight Vite's dev HMR).
setupInstallPrompt()
if ('serviceWorker' in navigator && import.meta.env.PROD && !(window as any).__TAURI_INTERNALS__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* install still works without offline caching */ })
  })
}
