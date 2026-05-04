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
    const { whereClause, params } = buildValidationWhereClause(filters);

    const patientConditions = [];
    const patientParams = [];

    if (filters.hpercode) {
      patientConditions.push("henctr.hpercode = ?");
      patientParams.push(filters.hpercode);
    }

    if (filters.enccode) {
      patientConditions.push("henctr.enccode = ?");
      patientParams.push(filters.enccode);
    }

    const patientWhereClause = patientConditions.length
      ? `WHERE ${patientConditions.join(" AND ")}`
      : "";

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
       ${patientWhereClause}
       ORDER BY henctr.enccode DESC
       LIMIT 1`,
      patientParams,
    );

    const resolvedHpercode = patientRows[0]?.hpercode || filters.hpercode;

    const submissionConditions = ["hdocord.docointkey IS NOT NULL", "hdocord.docointkey <> ''"];
    const submissionParams = [];

    if (resolvedHpercode) {
      submissionConditions.push("henctr.hpercode = ?");
      submissionParams.push(resolvedHpercode);
    }

    if (filters.enccode) {
      submissionConditions.push("henctr.enccode = ?");
      submissionParams.push(filters.enccode);
    }

    if (filters.user) {
      submissionConditions.push("hdocord.entryby = ?");
      submissionParams.push(filters.user);
    }

    const submissionWhereClause = submissionConditions.length
      ? `WHERE ${submissionConditions.join(" AND ")}`
      : "";

    const [submissionRows] = await pool.query(
      `SELECT
         hdocord.docointkey,
         henctr.enccode,
         hdocord.entryby AS user,
         COUNT(*) AS total_submissions
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       ${submissionWhereClause}
       GROUP BY hdocord.docointkey, henctr.enccode, hdocord.entryby
       ORDER BY hdocord.docointkey ASC, henctr.enccode DESC`,
      submissionParams,
    );

    const submissionIndex = indexSubmittedForms(submissionRows);
    const validations = buildValidationResults(
      filters.requestedForms,
      submissionIndex,
    );

    return res.json({
      ok: true,
      scope: {
        hpercode: resolvedHpercode || null,
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
