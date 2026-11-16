#!/usr/bin/env node
'use strict';
// Static deployment contract checks (npm run deploy:check). No cloud credentials or database needed.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const results = [];
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => (exists(rel) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
const check = (ok, message) => results.push({ ok: !!ok, message });
const json = (rel) => { try { return JSON.parse(read(rel)); } catch { return null; } };

const pkg = json('package.json') || {};
const vercel = json('vercel.json') || {};
const lock = json('package-lock.json') || {};
const front = json('frontend/package.json') || {};
const back = json('backend/package.json') || {};
const app = read('backend/src/app.js');
const server = read('backend/src/server.js');
const auth = read('backend/src/middleware/auth.js');
const runtime = read('backend/src/providers/runtimeCapabilities.js');
const media = read('backend/src/services/mediaService.js');
const gitignore = read('.gitignore');
const workflow = read('.github/workflows/ci.yml');

// Runtime
check(pkg.engines?.node === '26.x' && front.engines?.node === '26.x' && back.engines?.node === '26.x'
  && read('.nvmrc').trim() === read('.node-version').trim() && /^26\./.test(read('.nvmrc').trim()),
  'Node.js 26.x is pinned in every package, .nvmrc and .node-version.');

// Lockfile consistency: every declared dependency is in the lock, no removed package lingers
const declared = (p) => ({ ...(p.dependencies || {}), ...(p.devDependencies || {}) });
const lockFront = lock.packages?.frontend || {};
const lockBack = lock.packages?.backend || {};
const same = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
check(same(declared(front), declared(lockFront)) && same(declared(back), declared(lockBack))
  && same(declared(pkg), declared(lock.packages?.[''] || {})),
  'package-lock.json declares exactly the dependencies in each package.json.');
const unwanted = ['react-router-dom', 'lucide-react'].filter((n) => lock.packages?.[`node_modules/${n}`]);
check(unwanted.length === 0, `Removed frontend dependencies are gone from the lockfile${unwanted.length ? ` (${unwanted.join(', ')})` : ''}.`);

// Vercel
check(vercel.installCommand === 'npm ci' && vercel.buildCommand === 'npm run build' && vercel.outputDirectory === 'frontend/dist',
  'vercel.json installs with npm ci, builds the frontend and serves frontend/dist.');
const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
check(rewrites.some((r) => r.source === '/api/:path*' && r.destination === '/api?__loop_path=:path*')
  && rewrites.some((r) => r.source === '/(.*)' && r.destination === '/index.html'),
  'API requests go to the single Express function; every other path serves the single-page app.');
check(exists('api/index.js') && read('api/index.js').includes("require('../backend/src/app')"), 'api/index.js wraps the Express app for Vercel Functions.');
check(!vercel.crons, 'No Vercel cron jobs (background work runs only on a persistent host).');

// Server safety
check(/if\s*\(jobs\.enabled\)\s*scheduler\.start\(\)/.test(server), 'The scheduler starts only in the persistent server process.');
check(/if \(isServerless\) return false/.test(runtime) && /check\(\)\.state === 'disabled'\) return;/.test(media),
  'Local media is disabled on serverless hosts and never marked missing from there.');
check(/sameSite:\s*'strict'/.test(auth) && /httpOnly/.test(auth) && /csrfMatches/.test(auth), 'Strict httpOnly session cookies and CSRF checks are in place.');
check(/DATABASE_NOT_CONFIGURED/.test(app) && /\/api\/ready/.test(app), 'Missing database configuration returns a clear 503; /api/ready reports readiness.');
check(/^\s*\.env\s*$/m.test(gitignore) && /^\s*\.env\.\*\s*$/m.test(gitignore) && /^\s*!\.env\.example\s*$/m.test(gitignore)
  && /^media\/\*/m.test(gitignore), '.env files and private media are ignored by git.');
const envLines = read('.env.example').split('\n').filter((l) => /^[A-Z_]+=/.test(l));
check(exists('.env.example') && !envLines.some((l) => /=(?!replace-|change-me|false|true|\d|\.|http|loop|localhost|\+|\s*$).{12,}/.test(l)),
  '.env.example contains placeholders only.');

// Database
const migrations = fs.readdirSync(path.join(root, 'database/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
check(migrations.length >= 17 && migrations.at(-1).startsWith('0017_'), `Forward-only migrations present (latest ${migrations.at(-1)}).`);
check(!/(^|[^-])db:reset|DROP DATABASE/i.test(JSON.stringify(pkg.scripts)), 'No destructive database script is exposed at the root.');

// CI
check(/mysql/.test(workflow) && /npm run test:e2e|pytest e2e/.test(workflow) && /npm run test:sql/.test(workflow),
  'CI runs the API tests and browser tests against a real MySQL service.');

for (const r of results) (r.ok ? console.log : console.error)(`${r.ok ? 'PASS' : 'FAIL'}  ${r.message}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
