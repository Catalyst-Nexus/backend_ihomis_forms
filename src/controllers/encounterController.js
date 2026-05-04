const pool = require("../config/db");
const { fetchEncounterRecords } = require("../utils/dbHelpers");

/**
 * GET /api/db/henctr
 * Get encounter information with optional filters
 * Query params: enccode, fhud, docointkey, user, limit, offset
 */
async function getHenctrInfo(req, res, next) {
  try {
    const { enccode, fhud, docointkey, user } = req.query;
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

    if (docointkey) {
      conditions.push("hdocord.docointkey = ?");
      params.push(docointkey);
    }

    if (user) {
      conditions.push("hdocord.entryby = ?");
      params.push(user);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT
         hdocord.enccode,
         henctr.fhud,
         hdocord.docointkey,
         hdocord.entryby AS user,
         DATE_FORMAT(hdocord.dodate, '%Y-%m-%d') AS requestedDate,
         DATE_FORMAT(hdocord.dotime, '%H:%i:%s') AS requestedTime,
         CASE
           WHEN hdocord.dodate IS NULL AND hdocord.dotime IS NULL THEN NULL
           WHEN hdocord.dodate IS NULL THEN DATE_FORMAT(hdocord.dotime, '%Y-%m-%d %H:%i:%s')
           WHEN hdocord.dotime IS NULL THEN DATE_FORMAT(hdocord.dodate, '%Y-%m-%d %H:%i:%s')
           ELSE CONCAT(
             DATE_FORMAT(hdocord.dodate, '%Y-%m-%d'),
             ' ',
             DATE_FORMAT(hdocord.dotime, '%H:%i:%s')
           )
         END AS requestedAt,
         hperson.patfirst AS firstName,
         hperson.patmiddle AS middleName,
         hperson.patlast AS lastName
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode
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
        docointkey: docointkey || null,
        user: user || null,
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

/**
 * GET /api/db/patients/:hpercode/encounters/latest
 * Fetch the most recent encounter code for a patient
 */
async function getLatestEncounterForPatient(req, res, next) {
  try {
    const hpercode = String(req.params.hpercode || "").trim();

    if (!hpercode) {
      return res.status(400).json({
        ok: false,
        message: "hpercode is required",
      });
    }

    const [rows] = await pool.query(
      `
        SELECT
          a.enccode,
          a.hpercode,
          a.admdate,
          a.admtime,
          a.disdate,
          a.distime
        FROM hadmlog a
        WHERE a.hpercode = ?
        ORDER BY a.admdate DESC, a.admtime DESC
        LIMIT 1
      `,
      [hpercode],
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: "No encounter found for this patient.",
      });
    }

    const row = rows[0];

    return res.json({
      ok: true,
      hpercode,
      data: {
        enccode: row.enccode,
        admdate: row.admdate,
        admtime: row.admtime,
        disdate: row.disdate,
        distime: row.distime,
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/db/patients/:hpercode/encounters/:enccode/records
 * Get all encounter records for a specific patient encounter
 * Returns medical records, vital signs, diagnoses, medications, etc.
 */
async function getPatientEncounterRecords(req, res, next) {
  try {
    const hpercode = String(req.params.hpercode || "").trim();
    const enccode = String(req.params.enccode || "").trim();

    if (!hpercode || !enccode) {
      return res.status(400).json({
        ok: false,
        message: "Both hpercode and enccode are required",
      });
    }

    const { records, warnings } = await fetchEncounterRecords(enccode);

    const RECORD_CONFIGS = [
      { key: "other_details", single: false },
      { key: "vital_signs", single: true },
      { key: "medical_history", single: false },
      { key: "signs_and_symptoms", single: false },
      { key: "symptom_physical_others", single: false },
      { key: "physical_exam", single: false },
      { key: "system_review", single: false },
      { key: "ward_course", single: false },
      { key: "diagnoses", single: false },
      { key: "doctor_orders_medication", single: false },
      { key: "medical_supplies", single: false },
      { key: "doctor_orders_exams", single: false },
    ];

    const hasRecords = RECORD_CONFIGS.some((config) => {
      const value = records[config.key];
      if (config.single) {
        return Boolean(value);
      }
      return Array.isArray(value) && value.length > 0;
    });

    res.json({
      ok: true,
      hpercode,
      enccode,
      has_records: hasRecords,
      records,
      warnings,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getHenctrInfo,
  getLatestEncounterForPatient,
  getPatientEncounterRecords,
};
