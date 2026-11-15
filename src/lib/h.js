/* =========================================================================
 * h.js — hyperscript bindings for React
 *
 * The app is written against React's element API directly rather than JSX so
 * that the exact same source runs in three places with no transpiler:
 *   • the Vite dev server / production build (React from npm)
 *   • the zero-install single-file build (React attached to `window`)
 *   • node, for headless tests
 * ======================================================================== */
const React = globalThis.React;
if (!React) throw new Error('React must be available as globalThis.React before importing h.js');

export const {
  useState, useEffect, useRef, useMemo, useCallback, useReducer,
  useLayoutEffect, memo, Fragment, createElement,
} = React;

/**
 * h(tag, props?, ...children)
 * Children may be nested arrays; nulls are dropped.
 */
export function h(tag, props, ...children) {
  if (props !== null && props !== undefined && (typeof props !== 'object' || Array.isArray(props) || props.$$typeof)) {
    children = [props, ...children];
    props = null;
  }
  const flat = [];
  const walk = (c) => {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { c.forEach(walk); return; }
    flat.push(c);
  };
  children.forEach(walk);
  return React.createElement(tag, props, ...flat);
}

/** Tiny classnames helper. */
export const cx = (...parts) => parts.filter(Boolean).join(' ');

export default h;
