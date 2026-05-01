const pool = require("../config/db");
const { mapBabyFormRow } = require("../utils/dbHelpers");
const {
  BABY_FORM_SELECT_SQL,
  buildBabyFormWhereClause,
  normalizeBabyFormQuery,
} = require("../utils/babyFormHelpers");

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

module.exports = {
  listBabyFormRecords,
  getBabyFormRecords: listBabyFormRecords,
  getBabyForm: listBabyFormRecords,
};
