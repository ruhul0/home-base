'use strict';

// Creates a database in the format the app used before GitHub sign-in existed.
const mysql = require('mysql2/promise');

async function connect() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Could not connect to the database.');
}

(async () => {
  const connection = await connect();
  await connection.query('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, github_id BIGINT NOT NULL UNIQUE, login VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await connection.query('CREATE TABLE settings (name VARCHAR(64) PRIMARY KEY, value TEXT NOT NULL)');
  await connection.query("INSERT INTO settings VALUES ('seeded', '1')");
  await connection.query('CREATE TABLE sessions (token_hash CHAR(64) PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, INDEX sessions_expires_at (expires_at))');
  await connection.query(`INSERT INTO sessions (token_hash, expires_at) VALUES ('${'a'.repeat(64)}', NOW() + INTERVAL 1 DAY)`);
  await connection.query('CREATE TABLE link_groups (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, position INT NOT NULL)');
  await connection.query('CREATE TABLE links (id INT AUTO_INCREMENT PRIMARY KEY, group_id INT NOT NULL, name VARCHAR(100) NOT NULL, url VARCHAR(2048) NOT NULL, position INT NOT NULL, CONSTRAINT links_group FOREIGN KEY (group_id) REFERENCES link_groups (id) ON DELETE CASCADE)');
  await connection.query("INSERT INTO link_groups (id, name, position) VALUES (1, 'Business', 0)");
  await connection.query("INSERT INTO links (group_id, name, url, position) VALUES (1, 'UCC Webmail', 'https://mail.ucc.com.bd/', 0)");
  await connection.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
