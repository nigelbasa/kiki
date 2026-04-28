import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setPortal } from '@shared/api/client';
import '@shared/styles.css';

setPortal('public');

createRoot(document.getElementById('root')).render(<App />);
