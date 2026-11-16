#!/usr/bin/env node
// Static release audit for the LOOP interface (npm run ui:audit). No browser or database needed.
// It guards the product rules that are easy to break silently:
//   * the frontend talks only to LOOP's own /api, and every path it calls exists in the Express router
//   * no third-party music service names, embeds or URLs in the interface
//   * no database explorer or SQL screens
//   * User / Artist / Admin areas are separately guarded
//   * accessibility basics: viewport, skip link, focus style, reduced motion
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok: !!ok, detail });

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|css|html)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

const uiFiles = [...walk(path.join(root, 'frontend/src')), path.join(root, 'frontend/index.html')];
const ui = uiFiles.map((f) => ({ rel: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }));
const css = read('frontend/src/styles/loop.css');
const app = read('frontend/src/App.jsx');
const apiClient = read('frontend/src/lib/api.js');
const routes = read('backend/src/routes/index.js');

// 1. API contract: every path the client calls is a route the server defines.
const serverRoutes = [];
for (const m of routes.matchAll(/(router|A)\.(get|post|put|patch|delete)\('([^']+)'/g)) {
  serverRoutes.push({ method: m[2].toUpperCase(), path: (m[1] === 'A' ? '/admin' : '') + m[3] });
}
const toRegex = (p) => new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
const clientCalls = [];
const verbs = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' };
for (const m of apiClient.matchAll(/\b(get|post|put|patch|del)\(\s*[`']([^`']+)[`']/g)) {
  clientCalls.push({ method: verbs[m[1]], path: m[2].replace(/\$\{[^}]+\}/g, 'x') });
}
for (const m of apiClient.matchAll(/request\('([A-Z]+)', [`']([^`']+)[`']/g)) clientCalls.push({ method: m[1], path: m[2].replace(/\$\{[^}]+\}/g, 'x') });
const missing = clientCalls.filter((c) => !serverRoutes.some((s) => s.method === c.method && toRegex(s.path).test(c.path)));
check(`Every API call in the client exists on the server (${clientCalls.length} calls)`, clientCalls.length > 40 && missing.length === 0,
  missing.map((m) => `${m.method} ${m.path}`).join(', '));
check('The client only fetches LOOP’s own /api', !/fetch\((?!`\/api)/.test(ui.map((f) => f.text).join('\n')));

// 2. Independence from third-party music services.
const banned = /spotify|apple music|itunes|youtube|jamendo|deezer|soundcloud|musicbrainz|theaudiodb|kaggle|last\.fm|tidal|gaana|jiosaavn/i;
const hits = ui.filter((f) => banned.test(f.text)).map((f) => f.rel);
check('No third-party music service names in the interface', hits.length === 0, hits.join(', '));
const urls = ui.flatMap((f) => [...f.text.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => `${f.rel}: ${m[0]}`))
  .filter((u) => !/www\.w3\.org/.test(u));
check('No hard-coded external URLs in the interface', urls.length === 0, urls.join(', '));
check('No embedded players or iframes', !ui.some((f) => /<iframe|<embed|<object/i.test(f.text)));

// 3. No database exploration in the product.
check('No database explorer, schema or SQL screens', !ui.some((f) => /DatabaseExplorer|schemaExplorer|Query Studio|information_schema|SELECT \* FROM/i.test(f.text))
  && !/\/database\//.test(routes));

// 4. Separate, guarded role areas.
check('Studio is limited to Artists and the console to Admins in the router',
  /studio:\s*\['ARTIST'\]/.test(app) && /admin:\s*\['ADMIN'\]/.test(app) && /path: '\/studio\/:section'/.test(app) && /path: '\/admin\/:section'/.test(app));
check('Registration has no role field', !/role/i.test(read('frontend/src/pages/Auth.jsx').split('function validateRegistration')[1].split('export default')[0]));
check('Every Admin API route requires a permission', [...routes.matchAll(/^A\.(get|post|put|patch|delete)\('[^']+', ([^,]+),/gm)].every((m) => /^can\(/.test(m[2].trim())));

// 5. Accessibility and responsive basics.
check('Mobile viewport is configured', /name="viewport"/.test(read('frontend/index.html')));
check('Skip link, focus style and reduced motion are present', /Skip to content/.test(read('frontend/src/components/Shell.jsx'))
  && /:focus-visible/.test(css) && /prefers-reduced-motion:\s*reduce/.test(css));
check('Phone layout has a bottom navigation bar', /@media \(max-width: 959px\)[\s\S]*\.tabbar \{[\s\S]*position: fixed/.test(css));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}${!r.ok && r.detail ? `\n    ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} UI release checks passed.`);
process.exitCode = failed.length ? 1 : 0;
