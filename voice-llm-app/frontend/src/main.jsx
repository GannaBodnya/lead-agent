import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Carbon global styles — must be imported before component styles
import '@carbon/react/index.scss'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
