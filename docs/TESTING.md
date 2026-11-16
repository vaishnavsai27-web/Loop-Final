# Testing

| Layer | Where | Needs |
|---|---|---|
| Backend unit | `backend/tests/unit` | Node only |
| API integration | `backend/tests/*.test.js` | MySQL built with `db:setup` |
| Empty catalogue | `backend/tests/empty` | run by `npm run db:verify` |
| SQL contract | `backend/scripts/sql-contract-check.js` (`npm run test:sql`) | the target database |
| Frontend unit | `frontend/src/**/*.test.js` (Vitest) | Node only |
| Browser | `e2e/` (pytest + Playwright, axe-core) | running LOOP |
| Static audits | `npm run ui:audit`, `npm run deploy:check` | Node only |

The route, workflow and permission coverage matrix is in [../e2e/COVERAGE.md](../e2e/COVERAGE.md).
Integration and browser tests create their own users; they need a disposable database because they write to it.
