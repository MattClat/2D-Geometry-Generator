/* =========================================================================
 * bundle.mjs — builds `dist/tessellate-cad.html`, a single self-contained
 * page that runs offline with no install step.
 *
 * It does two jobs:
 *   1. wraps React's CommonJS production builds in a micro module registry
 *      and exposes them as globals;
 *   2. resolves this project's ES modules into the same registry (the source
 *      deliberately uses a small, statically analysable import/export subset).
 * =======================================================================*/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NM = '/home/claude/.npm-global/lib/node_modules';

/* ---------------- 1. React ---------------- */
const cjs = [
  ['scheduler', `${NM}/react-dom/node_modules/scheduler/cjs/scheduler.production.js`],
  ['react', `${NM}/react/cjs/react.production.js`],
  ['react-dom', `${NM}/react-dom/cjs/react-dom.production.js`],
  ['react-dom/client', `${NM}/react-dom/cjs/react-dom-client.production.js`],
];

function reactBundle() {
  const parts = [
    '(function(){',
    'var process = { env: { NODE_ENV: "production" } };',
    'var __m = {}, __c = {};',
    'function __req(id){',
    '  if (__c[id]) return __c[id].exports;',
    '  var mod = __c[id] = { exports: {} };',
    '  __m[id](mod, mod.exports, __req);',
    '  return mod.exports;',
    '}',
  ];
  for (const [id, file] of cjs) {
    parts.push(`__m[${JSON.stringify(id)}] = function(module, exports, require){\n${readFileSync(file, 'utf8')}\n};`);
  }
  parts.push('window.React = __req("react");');
  parts.push('window.ReactDOM = __req("react-dom/client");');
  parts.push('})();');
  return parts.join('\n');
}

/* ---------------- 2. project ES modules ---------------- */
const modules = new Map();

function idOf(file) { return relative(ROOT, file).replace(/\\/g, '/'); }

function collect(file) {
  const id = idOf(file);
  if (modules.has(id)) return id;
  modules.set(id, null); // reserve (guards against cycles)
  const src = readFileSync(file, 'utf8');
  const { code, deps } = transform(src, file);
  modules.set(id, { code, deps });
  return id;
}

/** Very small ES-module -> CJS rewriter for the subset this project uses. */
function transform(src, file) {
  const deps = [];
  const exportNames = new Set();
  let out = src;

  // --- imports (single and multi-line) ---
  out = out.replace(
    /^[ \t]*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (m, clause, spec) => {
      const target = resolve(dirname(file), spec);
      const id = collect(target);
      deps.push(id);
      const req = `__req(${JSON.stringify(id)})`;
      clause = clause.trim();
      if (clause.startsWith('*')) {
        const name = clause.replace(/^\*\s*as\s*/, '').trim();
        return `const ${name} = ${req};`;
      }
      if (clause.startsWith('{')) {
        const inner = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
        const bindings = inner.split(',').map((s) => s.trim()).filter(Boolean)
          .map((s) => s.replace(/\s+as\s+/, ': '));
        return `const { ${bindings.join(', ')} } = ${req};`;
      }
      // default (possibly with named): `X, { a, b }`
      const comma = clause.indexOf(',');
      if (comma >= 0) {
        const def = clause.slice(0, comma).trim();
        const rest = clause.slice(comma + 1).trim();
        const inner = rest.slice(rest.indexOf('{') + 1, rest.lastIndexOf('}'));
        const bindings = inner.split(',').map((s) => s.trim()).filter(Boolean)
          .map((s) => s.replace(/\s+as\s+/, ': '));
        return `const __ns_${def} = ${req}; const ${def} = __ns_${def}.default; const { ${bindings.join(', ')} } = __ns_${def};`;
      }
      return `const ${clause} = ${req}.default;`;
    },
  );

  // side-effect only imports (CSS etc.)
  out = out.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm, '');

  // --- export const { a, b } = ... ---
  out = out.replace(/^export\s+const\s*\{([\s\S]*?)\}\s*=/gm, (m, inner) => {
    inner.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const name = s.includes(':') ? s.split(':')[1].trim() : s;
      exportNames.add(name);
    });
    return `const {${inner}} =`;
  });

  // --- export const/let/var/function/class NAME ---
  out = out.replace(/^export\s+(async\s+)?(const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
    (m, asy, kw, name) => { exportNames.add(name); return `${asy || ''}${kw} ${name}`; });

  // --- export { a, b as c }; ---
  out = out.replace(/^export\s*\{([\s\S]*?)\};?[ \t]*$/gm, (m, inner) => {
    const lines = inner.split(',').map((s) => s.trim()).filter(Boolean);
    return lines.map((s) => {
      const [local, exported] = s.split(/\s+as\s+/).map((x) => x.trim());
      exportNames.add(exported || local);
      return `__exports[${JSON.stringify(exported || local)}] = ${local};`;
    }).join('\n');
  });

  // --- export default X; ---
  let hasDefault = false;
  out = out.replace(/^export\s+default\s+/gm, () => { hasDefault = true; return '__exports.default = '; });

  const tail = [...exportNames].map((n) => `__exports[${JSON.stringify(n)}] = ${n};`).join('\n');
  return { code: out + '\n' + tail + '\n', deps };
}

/* ---------------- assemble ---------------- */
const entry = resolve(ROOT, 'src/ui/App.js');
const entryId = collect(entry);

const appBundle = [
  '(function(){',
  '"use strict";',
  'var __m = {}, __c = {};',
  'function __req(id){',
  '  if (__c[id]) return __c[id].exports;',
  '  var __exports = {};',
  '  __c[id] = { exports: __exports };',
  '  __m[id](__exports, __req);',
  '  return __c[id].exports;',
  '}',
  ...[...modules.entries()].map(([id, m]) =>
    `__m[${JSON.stringify(id)}] = function(__exports, __req){\n${m.code}\n};`),
  `var __app = __req(${JSON.stringify(entryId)});`,
  'window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(__app.App));',
  '})();',
].join('\n');

const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tessellate CAD — procedural pattern studio</title>
<meta name="description" content="Generative 2D pattern playground that outputs production-clean SVG, DXF and STL for laser, plasma, CNC router, pen plotter and 3D printing." />
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${reactBundle()}
</script>
<script>
${appBundle}
</script>
</body>
</html>
`;

mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
const outFile = resolve(ROOT, 'dist/tessellate-cad.html');
writeFileSync(outFile, html);
console.log(`bundled ${modules.size} modules -> ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
