/**
 * Browser entry point: loads the global styles, registers every app (side-effect import of
 * `./apps`) and mounts the shell into `#root`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/glass.css';
import './apps';
import { Root } from './shell/Root';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
