/* =========================================================================
 * main.js — Vite entry point
 *
 * React is attached to the global scope before the app modules load, so the
 * identical UI source runs both under the Vite build (React from npm) and in
 * the dependency-free single-file build (React inlined into the page).
 * =======================================================================*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

globalThis.React = React;

Promise.all([import('./ui/App.js'), import('./lib/h.js')]).then(([app, lib]) => {
  createRoot(document.getElementById('root')).render(lib.h(app.App));
});
