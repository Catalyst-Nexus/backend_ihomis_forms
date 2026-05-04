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
      `SELECT DISTINCT
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
       ORDER BY henctr.enccode DESC`,
      patientParams,
    );

    const submissionConditions = ["hdocord.docointkey IS NOT NULL", "hdocord.docointkey <> ''"];
    const submissionParams = [];

    if (filters.hpercode) {
      submissionConditions.push("henctr.hpercode = ?");
      submissionParams.push(filters.hpercode);
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
         henctr.hpercode,
         henctr.enccode,
         hdocord.docointkey,
         hdocord.entryby AS user,
         COUNT(*) AS total_submissions
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       ${submissionWhereClause}
       GROUP BY henctr.hpercode, henctr.enccode, hdocord.docointkey, hdocord.entryby
       ORDER BY henctr.enccode DESC, hdocord.docointkey ASC`,
      submissionParams,
    );

    const data = patientRows.map((patientRow) => {
      const patientForms = submissionRows.filter(
        (row) =>
          row.hpercode === patientRow.hpercode &&
          row.enccode === patientRow.enccode,
      );

      const submissionIndex = indexSubmittedForms(patientForms);
      const validations = buildValidationResults(
        filters.requestedForms,
        submissionIndex,
      );

      return {
        hpercode: patientRow.hpercode || "",
        enccode: patientRow.enccode || "",
        fhud: patientRow.fhud || "",
        patient_name: patientRow.patient_name || "",
        first_name: patientRow.patfirst || "",
        middle_name: patientRow.patmiddle || "",
        last_name: patientRow.patlast || "",
        suffix: patientRow.patsuffix || "",
        sex: patientRow.patsex || "",
        birth_date: patientRow.patbdate || null,
        forms_count: patientForms.length,
        forms: validations,
      };
    });

    return res.json({
      ok: true,
      filters: {
        hpercode: filters.hpercode || null,
        enccode: filters.enccode || null,
        user: filters.user || null,
      },
      count: patientRows.length,
      data,
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
