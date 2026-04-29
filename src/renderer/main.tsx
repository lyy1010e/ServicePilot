import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { createServicePilotApi } from './tauri-bridge';
import './styles.css';

window.servicePilot = createServicePilotApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
