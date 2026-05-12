import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { createServicePilotApi } from './tauri-bridge';
import './styles.css';

performance.mark('sp-bridge-start');
window.servicePilot = createServicePilotApi();
performance.mark('sp-bridge-end');
performance.measure('sp: bridge init', 'sp-bridge-start', 'sp-bridge-end');

performance.mark('sp-react-start');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
