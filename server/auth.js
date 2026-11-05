'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const SESSION_DAYS = 365;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Only a hash of each token is stored, so reading the database doesn't reveal usable sessions.
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await db.pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ? DAY)',
    [hashToken(token), userId, SESSION_DAYS],
  );
  return token;
}

async function findSessionUser(token) {
  const [rows] = await db.pool.query(
    'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > NOW()',
    [hashToken(token)],
  );
  return rows.length ? rows[0].user_id : null;
}

async function deleteSession(token) {
  await db.pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

module.exports = { createSession, findSessionUser, deleteSession };
