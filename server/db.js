'use strict';

const mysql = require('mysql2/promise');
const defaults = require('./defaults');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  charset: 'utf8mb4',
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INT AUTO_INCREMENT PRIMARY KEY,
     github_id BIGINT NOT NULL UNIQUE,
     login VARCHAR(100) NOT NULL,
     preferences TEXT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash CHAR(64) PRIMARY KEY,
     user_id INT NOT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     expires_at DATETIME NOT NULL,
     INDEX sessions_expires_at (expires_at),
     CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS link_groups (
     id INT AUTO_INCREMENT PRIMARY KEY,
     user_id INT NULL,
     name VARCHAR(100) NOT NULL,
     position INT NOT NULL,
     CONSTRAINT link_groups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS links (
     id INT AUTO_INCREMENT PRIMARY KEY,
     group_id INT NOT NULL,
     name VARCHAR(100) NOT NULL,
     url VARCHAR(2048) NOT NULL,
     position INT NOT NULL,
     CONSTRAINT links_group FOREIGN KEY (group_id) REFERENCES link_groups (id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4`,
];

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

// Upgrades the database from the single-password version.
// Existing sites keep a NULL owner until the owner's first GitHub sign-in claims them.
async function upgradeFromPasswordVersion() {
  if (!(await columnExists('sessions', 'user_id'))) {
    await pool.query('DELETE FROM sessions');
    await pool.query(
      `ALTER TABLE sessions
         ADD COLUMN user_id INT NOT NULL,
         ADD CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`,
    );
  }
  if (!(await columnExists('link_groups', 'user_id'))) {
    await pool.query(
      `ALTER TABLE link_groups
         ADD COLUMN user_id INT NULL,
         ADD CONSTRAINT link_groups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`,
    );
  }
}

async function migrate() {
  for (const statement of SCHEMA) await pool.query(statement);
  await upgradeFromPasswordVersion();
  if (!(await columnExists('users', 'preferences'))) {
    await pool.query('ALTER TABLE users ADD COLUMN preferences TEXT NULL');
  }
}

async function writeGroups(connection, userId, groups) {
  await connection.query('DELETE FROM link_groups WHERE user_id = ?', [userId]);
  for (const [groupIndex, group] of groups.entries()) {
    const [result] = await connection.query(
      'INSERT INTO link_groups (user_id, name, position) VALUES (?, ?, ?)',
      [userId, group.name, groupIndex],
    );
    for (const [linkIndex, link] of group.links.entries()) {
      await connection.query(
        'INSERT INTO links (group_id, name, url, position) VALUES (?, ?, ?, ?)',
        [result.insertId, link.name, link.url, linkIndex],
      );
    }
  }
}

async function inTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Returns the user's id, or null if the site has reached its user limit.
function findOrCreateUser({ githubId, login, isOwner, maxUsers }) {
  return inTransaction(async (connection) => {
    const [existing] = await connection.query('SELECT id FROM users WHERE github_id = ?', [githubId]);
    if (existing.length) {
      // GitHub usernames can change, so accounts are matched on the permanent numeric id.
      await connection.query('UPDATE users SET login = ? WHERE id = ?', [login, existing[0].id]);
      return existing[0].id;
    }

    const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM users');
    if (total >= maxUsers) return null;

    const [created] = await connection.query(
      'INSERT INTO users (github_id, login) VALUES (?, ?)',
      [githubId, login],
    );
    const userId = created.insertId;

    if (isOwner) {
      const [claimed] = await connection.query(
        'UPDATE link_groups SET user_id = ? WHERE user_id IS NULL',
        [userId],
      );
      if (claimed.affectedRows > 0) return userId;
    }
    await writeGroups(connection, userId, defaults);
    return userId;
  });
}

async function getUser(userId) {
  const [rows] = await pool.query('SELECT login, preferences FROM users WHERE id = ?', [userId]);
  if (!rows.length) return null;
  return { login: rows[0].login, preferences: rows[0].preferences ? JSON.parse(rows[0].preferences) : {} };
}

async function setPreferences(userId, preferences) {
  await pool.query('UPDATE users SET preferences = ? WHERE id = ?', [JSON.stringify(preferences), userId]);
}

async function getGroups(userId) {
  const [groupRows] = await pool.query(
    'SELECT id, name FROM link_groups WHERE user_id = ? ORDER BY position',
    [userId],
  );
  if (groupRows.length === 0) return [];

  const [linkRows] = await pool.query(
    'SELECT group_id, name, url FROM links WHERE group_id IN (?) ORDER BY position',
    [groupRows.map((group) => group.id)],
  );
  return groupRows.map((group) => ({
    name: group.name,
    links: linkRows
      .filter((link) => link.group_id === group.id)
      .map((link) => ({ name: link.name, url: link.url })),
  }));
}

// Replaces one user's groups in a transaction, so a failed save leaves their old sites in place.
function replaceGroups(userId, groups) {
  return inTransaction((connection) => writeGroups(connection, userId, groups));
}

module.exports = { pool, migrate, findOrCreateUser, getUser, setPreferences, getGroups, replaceGroups };
