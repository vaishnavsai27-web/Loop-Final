#!/usr/bin/env node
// Server-side Admin provisioning. Admin access is never granted through the web
// UI or the registration API; it requires database owner credentials (.env
// DB_OWNER_USER / DB_OWNER_PASSWORD) and shell access to the server.
//
//   npm run admin:provision -- --promote <username-or-email>
//   ADMIN_PASSWORD='…' npm run admin:provision -- --create --username ops_admin --email ops@example.com --name "Ops Admin"
//   npm run admin:provision -- --list
//
// Every change is written to audit_logs (actor NULL = provisioning command).
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { db } = require('../src/config/env');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  console.error(`admin:provision — ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!db.ownerUser) return fail('DB_OWNER_USER is not set. Provisioning needs database owner credentials.');
  const conn = await mysql.createConnection({
    host: db.host, port: db.port, user: db.ownerUser, password: db.ownerPassword, database: db.database, charset: 'utf8mb4',
  });
  try {
    if (has('list')) {
      const [rows] = await conn.query(
        `SELECT u.user_id, u.username, u.email, u.is_active FROM users u JOIN roles r USING (role_id)
          WHERE r.code = 'ADMIN' ORDER BY u.user_id`);
      console.table(rows);
      return;
    }
    const [[adminRole]] = await conn.query("SELECT role_id FROM roles WHERE code = 'ADMIN'");
    if (!adminRole) return fail('The ADMIN role is missing. Run npm run db:migrate first.');

    if (has('promote')) {
      const login = String(arg('promote') || '').toLowerCase();
      if (!login) return fail('--promote needs a username or email.');
      await conn.beginTransaction();
      const [[u]] = await conn.query('SELECT user_id, username, is_active FROM users WHERE username = ? OR email = ? FOR UPDATE', [login, login]);
      if (!u) { await conn.rollback(); return fail(`No account matches "${login}".`); }
      if (!u.is_active) { await conn.rollback(); return fail(`Account "${u.username}" is deactivated; reactivate it first.`); }
      await conn.query('UPDATE users SET role_id = ? WHERE user_id = ?', [adminRole.role_id, u.user_id]);
      await conn.query(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
                        VALUES (NULL, 'ADMIN_PROVISIONED', 'user', ?, ?)`, [String(u.user_id), JSON.stringify({ via: 'admin:provision', mode: 'promote' })]);
      await conn.commit();
      console.log(`"${u.username}" is now an Admin. Their next request picks up the new role.`);
      return;
    }

    if (has('create')) {
      const username = String(arg('username') || '').toLowerCase();
      const email = String(arg('email') || '').toLowerCase();
      const name = String(arg('name') || username);
      const password = process.env.ADMIN_PASSWORD || '';
      if (!/^[a-z0-9_]{3,30}$/.test(username)) return fail('--username must be 3–30 lowercase letters, digits or _.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('--email must be a valid email address.');
      if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return fail('Set ADMIN_PASSWORD (at least 12 characters with letters and numbers) in the environment, not on the command line.');
      }
      const hash = await bcrypt.hash(password, 12);
      await conn.beginTransaction();
      const [r] = await conn.query('INSERT INTO users (username, email, password_hash, password_changed_at, role_id) VALUES (?, ?, ?, NOW(), ?)',
        [username, email, hash, adminRole.role_id]);
      await conn.query('INSERT INTO user_profiles (user_id, display_name) VALUES (?, ?)', [r.insertId, name.slice(0, 60)]);
      await conn.query(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, new_values)
                        VALUES (NULL, 'ADMIN_PROVISIONED', 'user', ?, ?)`, [String(r.insertId), JSON.stringify({ via: 'admin:provision', mode: 'create' })]);
      await conn.commit();
      console.log(`Admin account "${username}" created.`);
      return;
    }
    fail('Use --promote <login>, --create --username … --email … [--name …], or --list.');
  } catch (err) {
    await conn.rollback().catch(() => {});
    fail(err.code === 'ER_DUP_ENTRY' ? 'That username or email is already in use.' : (err.sqlMessage || err.message));
  } finally {
    await conn.end();
  }
}

main();
