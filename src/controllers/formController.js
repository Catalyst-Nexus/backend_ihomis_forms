const pool = require("../config/db");
const { mapBabyFormRow } = require("../utils/dbHelpers");
const {
  BABY_FORM_SELECT_SQL,
  buildBabyFormWhereClause,
  fetchBabyFormByHpercode,
  fetchEncounterMotherHpercode,
  generateNextBabyHpercode,
  normalizeBabyFormCreatePayload,
  normalizeBabyFormQuery,
  validateBabyFormCreatePayload,
} = require("../utils/babyFormHelpers");

async function listBabyFormRecords(req, res, next) {
  try {
    const filters = normalizeBabyFormQuery(req.query);
    const { whereClause, params } = buildBabyFormWhereClause(filters);

    const [rows] = await pool.query(
      `${BABY_FORM_SELECT_SQL}
       ${whereClause}
       ORDER BY nb.birthdate DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, filters.offset],
    );

    return res.json({
      ok: true,
      filters: {
        enccode: filters.enccode || null,
        babyHpercode: filters.babyHpercode || null,
      },
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        count: rows.length,
      },
      data: rows.map((row) => mapBabyFormRow(row)),
    });
  } catch (error) {
    next(error);
  }
}

async function createBabyFormRecord(req, res, next) {
  try {
    const payload = normalizeBabyFormCreatePayload(req.body);
    const validationMessage = validateBabyFormCreatePayload(payload);

    if (validationMessage) {
      return res.status(400).json({
        ok: false,
        message: validationMessage,
      });
    }

    const motherEncounter = await fetchEncounterMotherHpercode(pool, payload.enccode);

    if (!motherEncounter) {
      return res.status(404).json({
        ok: false,
        message: "Encounter not found",
      });
    }

    const babyHpercode = await generateNextBabyHpercode(pool);

    await pool.query(
      `INSERT INTO hnewborn (
        enccode,
        hpercode,
        firstname,
        middlename,
        lastname,
        sex,
        birthdate
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.enccode,
        babyHpercode,
        payload.baby_first_name,
        payload.baby_middle_name,
        payload.baby_last_name,
        payload.baby_sex,
        payload.baby_birth_date,
      ],
    );

    const babyForm = await fetchBabyFormByHpercode(pool, babyHpercode);

    return res.status(201).json({
      ok: true,
      message: "Baby form created successfully",
      data: babyForm
        ? mapBabyFormRow(babyForm)
        : {
            enccode: payload.enccode,
            baby_hpercode: babyHpercode,
            baby_first_name: payload.baby_first_name,
            baby_middle_name: payload.baby_middle_name,
            baby_last_name: payload.baby_last_name,
            baby_sex_code: payload.baby_sex,
            baby_birth_date: payload.baby_birth_date,
            mother_hpercode: motherEncounter.hpercode || "",
          },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listBabyFormRecords,
  getBabyFormRecords: listBabyFormRecords,
  getBabyForm: listBabyFormRecords,
  createBabyFormRecord,
  createBabyForm: createBabyFormRecord,
};
