// React entry point: mounts the root <App /> component into #root, wrapped in StrictMode.
// Serves as the only place that bootstraps the React tree.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
