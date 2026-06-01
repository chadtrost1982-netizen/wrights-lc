import "leaflet/dist/leaflet.css";

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initializeOneDriveAuth, resumePendingOneDriveUpload } from './utils/oneDriveGraph'

initializeOneDriveAuth()
  .catch(() => null)
  .finally(async () => {
    await resumePendingOneDriveUpload().catch(() => null)
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
