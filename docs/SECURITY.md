# Security and roles

## Authentication

* Passwords: bcrypt (cost 10; 12 for provisioned admins), 8–72 characters with a letter and a number. Five wrong
  passwords lock the account for 15 minutes; failed attempts are also rate-limited per IP.
* Sessions: random token, stored only as a SHA-256 hash in `auth_sessions`. Browsers get an httpOnly,
  SameSite=Strict cookie plus a readable CSRF cookie whose value must be echoed in `X-CSRF-Token` on every write.
  Tokens expire (`SESSION_TTL_HOURS`), can be revoked one by one or everywhere, and a password change signs out
  every other session.
* Every request re-reads the user, `is_active`, role and permissions, so deactivation and role changes apply at
  once.

## Roles and permissions

| Permission | User | Artist | Admin |
|---|---|---|---|
| `artist.studio`, `artist.upload` | | ✓ | |
| `catalog.write`, `users.manage`, `artist.review`, `health.view`, `audit.view` | | | ✓ |

* Registration ignores any role in the request and creates a User.
* Artist: `POST /artist/applications` → Admin approves in the console → artist profile linked, role becomes Artist.
* An Artist can edit only artist profiles linked to their account and upload only as those artists. Uploads stay in
  private quarantine; scanning (ClamAV + ffprobe), approval and publication are Admin-only, and nobody can review
  or publish their own upload.
* Admin is never granted from the console (`403 ADMIN_PROVISIONING_ONLY`). Provision from the server:

  ```bash
  npm run admin:provision -- --promote some_username
  ADMIN_PASSWORD='a-long-password-1' npm run admin:provision -- --create --username ops_admin --email ops@example.com --name "Ops Admin"
  npm run admin:provision -- --list
  ```

  It uses the database owner account and writes `ADMIN_PROVISIONED` to the audit log. The last active Admin cannot
  be demoted or deleted.

## Before a public deployment

* The development seed creates accounts with published passwords (`admin`, `varsha`, …). Do not seed a public
  database. If an existing database came from the seed, provision a real Admin, then deactivate the seeded accounts
  in Admin → Users and roles.
* Set a 32+ character `SESSION_SECRET`, `COOKIE_SECURE=true`, the exact `CORS_ORIGIN`, `TRUST_PROXY` for your proxy
  chain, and TLS to MySQL (`DB_SSL=true`).
* The API connects with the least-privilege `DB_APP_USER`; keep owner credentials off the web host where possible.
