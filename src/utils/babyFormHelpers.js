const BABY_FORM_SELECT_SQL = `
  SELECT
    nb.enccode,
    nb.hpercode AS baby_hpercode,
    nb.firstname AS baby_first_name,
    nb.middlename AS baby_middle_name,
    nb.lastname AS baby_last_name,
    nb.sex AS baby_sex_code,
    nb.birthdate AS baby_birth_date,
    hen.hpercode AS mother_hpercode,
    hp.patfirst AS mother_first_name,
    hp.patmiddle AS mother_middle_name,
    hp.patlast AS mother_last_name,
    hp.patsuffix AS mother_suffix,
    hp.patsex AS mother_sex_code,
    COALESCE(NULLIF(hadm.pho_hospital_number, ''), nb.hpercode) AS hospital_number,
    hd.del_presentation AS delivery_type,
    hd.obindex AS ob_index,
    hd.deliverydte AS delivery_date,
    (
      SELECT ad.patstr
      FROM haddr ad
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_street,
    (
      SELECT ad.brg
      FROM haddr ad
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_barangay_code,
    (
      SELECT br.bgyname
      FROM haddr ad
      INNER JOIN hbrgy br ON br.bgycode = ad.brg
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_barangay,
    (
      SELECT ct.ctyname
      FROM haddr ad
      INNER JOIN hcity ct ON ct.ctycode = ad.ctycode
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_city,
    (
      SELECT pv.provname
      FROM haddr ad
      INNER JOIN hprov pv ON pv.provcode = ad.provcode
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_province,
    (
      SELECT rg.regname
      FROM haddr ad
      INNER JOIN hcity ct ON ct.ctycode = ad.ctycode
      INNER JOIN hregion rg ON rg.regcode = ct.ctyreg
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_region,
    (
      SELECT ad.patzip
      FROM haddr ad
      WHERE ad.hpercode = hp.hpercode
      LIMIT 1
    ) AS address_zip,
    (
      SELECT pp.attenddr
      FROM hpostpartum pp
      WHERE pp.enccode = nb.enccode
        AND pp.attenddr IS NOT NULL
        AND pp.attenddr <> ''
      ORDER BY pp.attendsigndate DESC
      LIMIT 1
    ) AS obstetrician_license_no,
    (
      SELECT CONCAT_WS(' ', pe.firstname, pe.middlename, pe.lastname, pe.empsuffix)
      FROM hpostpartum pp
      INNER JOIN hprovider pr ON pr.licno = pp.attenddr
      INNER JOIN hpersonal pe ON pe.employeeid = pr.employeeid
      WHERE pp.enccode = nb.enccode
        AND pp.attenddr IS NOT NULL
        AND pp.attenddr <> ''
      ORDER BY pp.attendsigndate DESC
      LIMIT 1
    ) AS obstetrician_name,
    (
      SELECT pl.anestype
      FROM hproclog pl
      WHERE pl.enccode = nb.enccode
        AND pl.anestype IS NOT NULL
        AND pl.anestype <> ''
      ORDER BY pl.hplscdte DESC
      LIMIT 1
    ) AS anesthesia_type,
    (
      SELECT pl.aneslicno
      FROM hproclog pl
      WHERE pl.enccode = nb.enccode
        AND pl.aneslicno IS NOT NULL
        AND pl.aneslicno <> ''
      ORDER BY pl.hplscdte DESC
      LIMIT 1
    ) AS anesthesiologist_license_no,
    (
      SELECT CONCAT_WS(' ', pe.firstname, pe.middlename, pe.lastname, pe.empsuffix)
      FROM hproclog pl
      INNER JOIN hprovider pr ON pr.licno = pl.aneslicno
      INNER JOIN hpersonal pe ON pe.employeeid = pr.employeeid
      WHERE pl.enccode = nb.enccode
        AND pl.aneslicno IS NOT NULL
        AND pl.aneslicno <> ''
      ORDER BY pl.hplscdte DESC
      LIMIT 1
    ) AS anesthesiologist_name
  FROM hnewborn nb
  LEFT JOIN henctr hen ON hen.enccode = nb.enccode
  LEFT JOIN hperson hp ON hp.hpercode = hen.hpercode
  LEFT JOIN hadmlog hadm ON hadm.enccode = nb.enccode
  LEFT JOIN hdelivery hd ON hd.enccode = nb.enccode
`;

function normalizeBabyFormQuery(query = {}) {
  return {
    enccode: String(query.enccode || "").trim(),
    babyHpercode: String(
      query.babyHpercode || query.baby_hpercode || query.hpercode || "",
    ).trim(),
    limit: Math.min(parseInt(query.limit, 10) || 50, 1000),
    offset: Math.max(parseInt(query.offset, 10) || 0, 0),
  };
}

function buildBabyFormWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.enccode) {
    conditions.push("nb.enccode = ?");
    params.push(filters.enccode);
  }

  if (filters.babyHpercode) {
    conditions.push("nb.hpercode = ?");
    params.push(filters.babyHpercode);
  }

  return {
    conditions,
    params,
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function normalizeBabyFormCreatePayload(body = {}) {
  return {
    enccode: String(body.enccode || "").trim(),
    baby_first_name: String(body.baby_first_name || "").trim(),
    baby_middle_name: String(body.baby_middle_name || "").trim(),
    baby_last_name: String(body.baby_last_name || "").trim(),
    baby_sex: String(body.baby_sex || "").trim().toUpperCase(),
    baby_birth_date: String(body.baby_birth_date || "").trim(),
  };
}

function validateBabyFormCreatePayload(payload) {
  if (
    !payload.enccode ||
    !payload.baby_first_name ||
    !payload.baby_last_name ||
    !payload.baby_sex ||
    !payload.baby_birth_date
  ) {
    return "Missing required fields: enccode, baby_first_name, baby_last_name, baby_sex, baby_birth_date";
  }

  if (!["M", "F"].includes(payload.baby_sex)) {
    return "baby_sex must be 'M' or 'F'";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.baby_birth_date)) {
    return "baby_birth_date must be in YYYY-MM-DD format";
  }

  return null;
}

async function fetchEncounterMotherHpercode(pool, enccode) {
  const [rows] = await pool.query(
    "SELECT hpercode FROM henctr WHERE enccode = ? LIMIT 1",
    [enccode],
  );

  return rows[0] || null;
}

async function generateNextBabyHpercode(pool) {
  const [rows] = await pool.query(
    "SELECT MAX(CAST(SUBSTRING(hpercode, -6) AS UNSIGNED)) AS max_id FROM hperson",
  );
  const nextId = (rows[0]?.max_id || 0) + 1;

  return String(nextId).padStart(6, "0");
}

async function fetchBabyFormByHpercode(pool, babyHpercode) {
  const [rows] = await pool.query(
    `${BABY_FORM_SELECT_SQL}
     WHERE nb.hpercode = ?
     LIMIT 1`,
    [babyHpercode],
  );

  return rows[0] || null;
}

module.exports = {
  BABY_FORM_SELECT_SQL,
  normalizeBabyFormQuery,
  buildBabyFormWhereClause,
  normalizeBabyFormCreatePayload,
  validateBabyFormCreatePayload,
  fetchEncounterMotherHpercode,
  generateNextBabyHpercode,
  fetchBabyFormByHpercode,
};