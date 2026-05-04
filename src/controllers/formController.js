const pool = require("../config/db");
const { mapBabyFormRow } = require("../utils/dbHelpers");
const {
  BABY_FORM_SELECT_SQL,
  buildBabyFormWhereClause,
  normalizeBabyFormQuery,
} = require("../utils/babyFormHelpers");
const {
  buildValidationResults,
  buildValidationWhereClause,
  indexSubmittedForms,
  normalizeValidationQuery,
  serializeSubmissionIndex,
} = require("../utils/formValidationHelpers");

async function listBabyFormRecords(req, res, next) {
  try {
    const filters = normalizeBabyFormQuery(req.query);
    const { whereClause, params } = buildBabyFormWhereClause(filters);

    const [rows] = await pool.query(
      `${BABY_FORM_SELECT_SQL}
       ${whereClause}
       ORDER BY nb.birthdate DESC`,
      params,
    );

    return res.json({
      ok: true,
      filters: {
        enccode: filters.enccode || null,
        babyHpercode: filters.babyHpercode || null,
      },
      count: rows.length,
      data: rows.map((row) => mapBabyFormRow(row)),
    });
  } catch (error) {
    next(error);
  }
}

async function validateFormRecords(req, res, next) {
  try {
    const filters = normalizeValidationQuery(req.query);

    if (!filters.hpercode) {
      return res.status(400).json({
        ok: false,
        message: "hpercode is required",
      });
    }

    const { whereClause, params } = buildValidationWhereClause(filters);

    const [patientRows] = await pool.query(
      `SELECT
         henctr.hpercode,
         henctr.enccode,
         henctr.fhud,
         hperson.patfirst,
         hperson.patmiddle,
         hperson.patlast,
         hperson.patsuffix,
         hperson.patsex,
         hperson.patbdate,
         CONCAT_WS(' ', hperson.patlast, hperson.patfirst, hperson.patmiddle, hperson.patsuffix) AS patient_name
       FROM henctr
       LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode
       WHERE henctr.hpercode = ?
       ${filters.enccode ? "AND henctr.enccode = ?" : ""}
       ORDER BY henctr.enccode DESC
       LIMIT 1`,
      filters.enccode ? [filters.hpercode, filters.enccode] : [filters.hpercode],
    );

    const [submissionRows] = await pool.query(
      `SELECT
         hdocord.docointkey,
         hdocord.enccode,
         hdocord.entryby AS user,
         COUNT(*) AS total_submissions
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       ${whereClause}
       GROUP BY hdocord.docointkey, hdocord.enccode, hdocord.entryby
       ORDER BY hdocord.docointkey ASC, hdocord.enccode DESC`,
      params,
    );

    const submissionIndex = indexSubmittedForms(submissionRows);
    const validations = buildValidationResults(
      filters.requestedForms,
      submissionIndex,
    );

    return res.json({
      ok: true,
      scope: {
        hpercode: filters.hpercode,
        enccode: filters.enccode || null,
        user: filters.user || null,
      },
      patient: patientRows[0]
        ? {
            hpercode: patientRows[0].hpercode || filters.hpercode,
            enccode: patientRows[0].enccode || filters.enccode || null,
            fhud: patientRows[0].fhud || null,
            patient_name: patientRows[0].patient_name || "",
            first_name: patientRows[0].patfirst || "",
            middle_name: patientRows[0].patmiddle || "",
            last_name: patientRows[0].patlast || "",
            suffix: patientRows[0].patsuffix || "",
            sex: patientRows[0].patsex || "",
            birth_date: patientRows[0].patbdate || null,
          }
        : null,
      counts: {
        requested_forms: filters.requestedForms.length,
        submitted_forms: submissionRows.length,
        matched_forms: validations.filter((item) => item.exists).length,
        missing_forms: validations.filter((item) => !item.exists).length,
      },
      requested_forms: filters.requestedForms,
      submitted_forms: serializeSubmissionIndex(submissionIndex),
      data: validations,
      missing_forms: validations.filter((item) => !item.exists),
      existing_forms: validations.filter((item) => item.exists),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listBabyFormRecords,
  validateFormRecords,
  getBabyFormRecords: listBabyFormRecords,
  getBabyForm: listBabyFormRecords,
  validatePatientForms: validateFormRecords,
  validateForms: validateFormRecords,
};
