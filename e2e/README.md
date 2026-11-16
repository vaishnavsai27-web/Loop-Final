# LOOP browser tests (Playwright + pytest)

These tests drive the real application in Chromium: the built frontend, the Express API and MySQL.
They create their own users, so they can run in any order against a fresh `db:setup` database.

```bash
npm ci                                   # also installs axe-core for the accessibility checks
npm run db:seed:generate
npm run db:setup -- --allow-destructive  # disposable database only
npm run build && npm start               # serves the API and frontend on :4000
pip install pytest playwright && python -m playwright install chromium
BASE_URL=http://localhost:4000 python -m pytest e2e -q
```

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:4000` | Running LOOP instance |
| `E2E_ADMIN_LOGIN` / `E2E_ADMIN_PASSWORD` | seeded `admin` account | Admin used for approvals |
| `SHOTS` | `e2e/screenshots` | Full-page screenshots of every user route at three sizes |

Each test fails on browser console errors, page errors or 5xx API responses where it says so, and
`test_ui.py` checks every route at mobile (390×844), tablet (820×1180) and desktop (1440×900) for
sideways scrolling. See [COVERAGE.md](COVERAGE.md) for the route, workflow and permission matrix.
