const pool = require("../config/db");

function escapeIdentifier(identifier) {
  return String(identifier).replace(/`/g, "``");
}

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

async function getHenctrInfo(req, res, next) {
  try {
    const { enccode, fhud } = req.query;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);

    const limit = Number.isNaN(parsedLimit)
      ? 100
      : Math.min(Math.max(parsedLimit, 1), 500);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

    const conditions = [
      "hdocord.docointkey IS NOT NULL",
      "hdocord.docointkey <> ''",
    ];
    const params = [];

    if (enccode) {
      conditions.push("hdocord.enccode = ?");
      params.push(enccode);
    }

    if (fhud) {
      conditions.push("henctr.fhud = ?");
      params.push(fhud);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT hdocord.enccode, henctr.fhud, hdocord.docointkey
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       ${whereClause}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      ok: true,
      count: rows.length,
      filters: {
        enccode: enccode || null,
        fhud: fhud || null,
      },
      pagination: {
        limit,
        offset,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

async function searchPatients(req, res, next) {
  try {
    const { search, q, user, fhud, enccode } = req.query;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isNaN(parsedLimit)
      ? 25
      : Math.min(Math.max(parsedLimit, 1), 200);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
    const keyword = String(search || q || "").trim();

    const conditions = [
      "hdocord.docointkey IS NOT NULL",
      "hdocord.docointkey <> ''",
    ];
    const params = [];

    if (fhud) {
      conditions.push("henctr.fhud = ?");
      params.push(fhud);
    }

    if (enccode) {
      conditions.push("hdocord.enccode = ?");
      params.push(enccode);
    }

    if (keyword) {
      conditions.push(
        "(" +
          "hdocord.enccode LIKE ? OR " +
          "henctr.fhud LIKE ? OR " +
          "hdocord.docointkey LIKE ? OR " +
          "CONCAT_WS(' ', hperson.patfirst, hperson.patmiddle, hperson.patlast) LIKE ?" +
          ")",
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }

    if (user) {
      // Replace hdocord.entryby with your actual username column in hdocord
      conditions.push("hdocord.entryby = ?");
      params.push(user);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await pool.query(
      `SELECT
         hdocord.enccode,
         henctr.fhud,
         hdocord.docointkey,
         hperson.patfirst AS firstName,
         hperson.patmiddle AS middleName,
         hperson.patlast AS lastName
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode
       ${whereClause}
       ORDER BY hdocord.docointkey DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      ok: true,
      count: rows.length,
      pagination: { limit, offset },
      filters: {
        search: keyword || null,
        user: user || null,
        fhud: fhud || null,
        enccode: enccode || null,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}
module.exports = {
  dbStatus,
  listTables,
  dbInfo,
  getHenctrInfo,
};
