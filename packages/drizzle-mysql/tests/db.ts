import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'

/**
 * Connection for the MySQL tests, from `MYSQL_URL`
 * (e.g. `mysql://root:root@127.0.0.1:3306/dqlkit`). Without it the
 * suites are skipped locally; CI sets it and fails when it is missing.
 */
export const mysqlUrl = process.env.MYSQL_URL
if (!mysqlUrl && process.env.CI) {
  throw new Error('MYSQL_URL must be set in CI: the MySQL suites would be skipped otherwise')
}

export const connect = async () => {
  const pool = mysql.createPool({ uri: mysqlUrl!, timezone: 'Z', multipleStatements: true, connectionLimit: 1 })
  await pool.query("SET time_zone = '+00:00'")
  return { pool, db: drizzle(pool) }
}

/** `YYYY-MM-DD HH:MM:SS.mmm` in UTC, how the fixtures store instants. */
export const utc = (v: string | null) =>
  v === null ? null : new Date(v).toISOString().replace('T', ' ').replace('Z', '')
