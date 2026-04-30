const pool = require("../config/db");
const { escapeIdentifier } = require("../utils/dbHelpers");

/**
 * GET /api/db/status
 * Check database connection and basic health status
 */
async function dbStatus(req, res, next) {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");

    res.json({
      ok: true,
      database: process.env.MYSQL_DATABASE,
      host: process.env.MYSQL_HOST,
      ping: rows[0]?.ok === 1,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/db/tables
 * List all tables in the database
 */
async function listTables(req, res, next) {
  try {
    const [rows] = await pool.query("SHOW TABLES");

    res.json({
      ok: true,
      count: rows.length,
      tables: rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/db/info
 * Get database connection info and facility code
 */
async function dbInfo(req, res) {
  const result = {
    ok: false,
    configuredDatabase: process.env.MYSQL_DATABASE || null,
    configuredHost: process.env.MYSQL_HOST || null,
    connectedDatabase: null,
    facilityCode: null,
    facilityCodeSource: null,
    timestamp: new Date().toISOString(),
  };

  try {
    const [dbRows] = await pool.query("SELECT DATABASE() AS databaseName");
    result.connectedDatabase = dbRows[0]?.databaseName || null;

    const [candidates] = await pool.query(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          LOWER(COLUMN_NAME) = 'facility_code'
          OR LOWER(COLUMN_NAME) = 'facilitycode'
          OR LOWER(COLUMN_NAME) = 'fac_code'
          OR LOWER(COLUMN_NAME) = 'faccode'
          OR LOWER(COLUMN_NAME) LIKE '%facility%code%'
        )
      ORDER BY
        CASE
          WHEN LOWER(COLUMN_NAME) = 'facility_code' THEN 1
          WHEN LOWER(COLUMN_NAME) = 'facilitycode' THEN 2
          ELSE 3
        END,
        TABLE_NAME
      LIMIT 8
    `);

    for (const candidate of candidates) {
      const tableName = escapeIdentifier(candidate.TABLE_NAME);
      const columnName = escapeIdentifier(candidate.COLUMN_NAME);

      const [rows] = await pool.query(
        `SELECT \`${columnName}\` AS facilityCode FROM \`${tableName}\` WHERE \`${columnName}\` IS NOT NULL LIMIT 1`,
      );

      if (
        rows[0]?.facilityCode !== undefined &&
        rows[0]?.facilityCode !== null &&
        rows[0]?.facilityCode !== ""
      ) {
        result.facilityCode = String(rows[0].facilityCode);
        result.facilityCodeSource = `${candidate.TABLE_NAME}.${candidate.COLUMN_NAME}`;
        break;
      }
    }

    result.ok = true;
    res.json(result);
  } catch (error) {
    res.status(200).json({
      ...result,
      error: error.message,
      note: "Database is not reachable yet. configuredDatabase is shown from environment only.",
    });
  }
}

module.exports = {
  dbStatus,
  listTables,
  dbInfo,
};
