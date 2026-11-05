# Restoring from an R2 backup

You need the private key (`AGE-SECRET-KEY-…`) from your password manager. Backups can't be read without it.

## 1. Get the files

In Cloudflare, open **R2 → your bucket** and download the newest files from:

- `database/chrome_home-<date>.sql.gz.age`, your MySQL data
- `settings/env-<date>.age`, the server's `.env`, only needed on a new server

## 2. Decrypt

Save the private key to a temporary file, such as `key.txt`, and install [age](https://github.com/FiloSottile/age). If you don't have it, the app's backup image includes it.

```bash
age -d -i key.txt -o chrome_home.sql.gz database-file.sql.gz.age
gunzip chrome_home.sql.gz
age -d -i key.txt -o .env settings-file.age
```

Delete `key.txt` when you're finished.

## 3. Restore

On a new server, clone the repository into `~/chrome-home`, put the decrypted `.env` beside `docker-compose.yml` with `chmod 600 .env`, and start the database:

```bash
docker compose up -d db
```

Then load the data. This replaces what's in the database, so on an existing server make sure you mean to do it:

```bash
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" chrome_home' < chrome_home.sql
docker compose up -d --build app
```

If the `.env` you restored isn't from the same date, stored GitHub tokens may not decrypt. Users would then see a prompt to connect GitHub again, and nothing else is affected.

## Test this occasionally

A backup you've never restored isn't proven. Every few months, decrypt the newest backup and check the file looks right. `deploy/test-backup.sh` tests the whole cycle automatically with a fake R2.
