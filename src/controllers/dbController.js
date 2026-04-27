const pool = require("../config/db");

function escapeIdentifier(identifier) {
  return String(identifier).replace(/`/g, "``");
}

function mapSex(sexCode) {
  if (!sexCode) return "";
  const code = String(sexCode).toUpperCase();
  if (code === "M" || code === "MALE" || code === "1") return "male";
  if (code === "F" || code === "FEMALE" || code === "2") return "female";
  return "unknown";
}

function formatDate(date) {
  if (!date) return "";
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function mapPatientRow(row) {
  return {
    id: row.hpercode || "",
    hpercode: row.hpercode || "",
    first_name: row.patfirst || "",
    middle_name: row.patmiddle || "",
    last_name: row.patlast || "",
    ext_name: row.patsuffix || "",
    sex: mapSex(row.patsex),
    birth_date: formatDate(row.patbdate),
    birth_place: row.patbplace || "",
    civil_status_code: row.patcstat || "",
    nationality_code: row.natcode || "",
    religion_code: row.relcode || "",
    contact_number: row.pattelno || "",
    father_last_name: row.fatlast || "",
    father_middle_name: row.fatmid || "",
    father_first_name: row.fatfirst || "",
    mother_last_name: row.motlast || "",
    mother_first_name: row.motfirt || "",
    mother_middle_name: row.motmid || "",
    employment_status: row.patempstat || "",
    facility_code: row.hfhudcode || "",
    facility_name: row.facility_name || "",
    created_at: "",
    brgy: row.bgycode || "",
    brgy_name: row.bgyname || "",
    street: row.patstr || "",
    city_code: row.ctycode || "",
    city_name: row.ctyname || "",
    province_code: row.provcode || "",
    province_name: row.provname || "",
    region_name: row.regname || "",
    zip_code: row.patzip || "",
  };
}

function buildFullName(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function calculateAgeFromDate(date) {
  if (!date) {
    return {
      days: null,
      display: "",
    };
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return {
      days: null,
      display: "",
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = Math.max(0, Date.now() - parsed.getTime());
  const totalDays = Math.floor(diffMs / msPerDay);

  if (totalDays < 31) {
    return { days: totalDays, display: `${totalDays} day(s)` };
  }

  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30);
    return { days: totalDays, display: `${months} month(s)` };
  }

  const years = Math.floor(totalDays / 365);
  return { days: totalDays, display: `${years} year(s)` };
}

function mapBabyFormRow(row) {
  const babyAge = calculateAgeFromDate(row.baby_birth_date);

  const babyName = buildFullName(
    row.baby_first_name,
    row.baby_middle_name,
    row.baby_last_name,
  );

  const motherName = buildFullName(
    row.mother_first_name,
    row.mother_middle_name,
    row.mother_last_name,
    row.mother_suffix,
  );

  const completeAddress = [
    row.address_street,
    row.address_barangay,
    row.address_city,
    row.address_province,
    row.address_region,
    row.address_zip,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");

  return {
    enccode: row.enccode || "",
    baby_hpercode: row.baby_hpercode || "",
    mother_hpercode: row.mother_hpercode || "",
    baby_name: babyName,
    baby_sex: mapSex(row.baby_sex_code),
    baby_birth_date: formatDate(row.baby_birth_date),
    baby_age: babyAge.display,
    baby_age_days: babyAge.days,
    mother_name: motherName,
    mother_sex: mapSex(row.mother_sex_code),
    hospital_no: row.hospital_number || "",
    complete_address: completeAddress,
    type_of_delivery: row.delivery_type || "",
    obstetrician: row.obstetrician_name || row.obstetrician_license_no || "",
    obstetrician_license_no: row.obstetrician_license_no || "",
    anesthesia: row.anesthesia_type || "",
    anesthesiologist:
      row.anesthesiologist_name || row.anesthesiologist_license_no || "",
    anesthesiologist_license_no: row.anesthesiologist_license_no || "",
    source_tables: {
      baby: "hnewborn",
      mother: "henctr + hperson",
      hospital_no: "COALESCE(hadmlog.pho_hospital_number, henctr.fhud)",
      address: "haddr + hbrgy + hcity + hprov + hregion",
      delivery: "hdelivery",
      obstetrician: "hpostpartum + hprovider + hpersonal",
      anesthesia: "hproclog + hprovider + hpersonal",
    },
  };
}

const RECORD_CONFIGS = [
  { key: "other_details", table: "hvsothr" },
  { key: "vital_signs", table: "hvitalsign", single: true },
  { key: "medical_history", table: "hmrhisto" },
  { key: "signs_and_symptoms", table: "hsignsymptoms" },
  { key: "symptom_physical_others", table: "hpesignsothers" },
  { key: "physical_exam", table: "hphyexam" },
  { key: "system_review", table: "hmrsrev" },
  { key: "ward_course", table: "hcrsward" },
  { key: "diagnoses", table: "hencdiag" },
  { key: "doctor_orders_medication", table: "hrxo" },
  { key: "medical_supplies", table: "hrqd" },
  {
    key: "doctor_orders_exams",
    table: "hdocord",
    sql: "SELECT * FROM hdocord WHERE enccode = ? AND estatus = 'S'",
  },
];

const CHRONOLOGICAL_TABLE_KEYS = new Set([
  "ward_course",
  "doctor_orders_medication",
  "medical_supplies",
  "doctor_orders_exams",
]);

const DISCHARGE_REGEX = /disch(?:arge)?/i;

function createEmptyRecordBucket() {
  return RECORD_CONFIGS.reduce((bucket, config) => {
    bucket[config.key] = config.single ? null : [];
    return bucket;
  }, {});
}

function findMatchingKey(keys, matcher) {
  return keys.find((key) => matcher(key.toLowerCase()));
}

function toTimestamp(value, time) {
  if (!value && !time) {
    return null;
  }

  const combined = [value, time].filter(Boolean).join(" ");
  const parsed = new Date(combined);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

  return null;
}

function sortRowsByDateTime(rows) {
  if (!rows?.length) {
    return rows;
  }

  const keys = Object.keys(rows[0]);
  const dateKey = findMatchingKey(keys, (name) => name.includes("date"));
  if (!dateKey) {
    return rows;
  }

  const timeKey = findMatchingKey(keys, (name) => name.includes("time"));

  return [...rows].sort((a, b) => {
    const aTs = toTimestamp(a[dateKey], timeKey ? a[timeKey] : null);
    const bTs = toTimestamp(b[dateKey], timeKey ? b[timeKey] : null);

    if (aTs === null && bTs === null) {
      return 0;
    }
    if (aTs === null) {
      return 1;
    }
    if (bTs === null) {
      return -1;
    }

    return aTs - bTs;
  });
}

function filterDischargeOrders(rows) {
  if (!rows?.length) {
    return rows;
  }

  const keys = Object.keys(rows[0]);
  const descriptionKey = findMatchingKey(keys, (name) => name.includes("desc"));
  if (!descriptionKey) {
    return rows;
  }

  return rows.filter(
    (row) => !DISCHARGE_REGEX.test(String(row[descriptionKey] ?? "").trim()),
  );
}

async function fetchEncounterRecords(enccode) {
  const records = createEmptyRecordBucket();
  const warnings = [];

  for (const config of RECORD_CONFIGS) {
    const sql = config.sql ?? `SELECT * FROM ${config.table} WHERE enccode = ?`;
    try {
      const [rows] = await pool.query(sql, [enccode]);
      records[config.key] = config.single ? (rows[0] ?? null) : rows;
    } catch (error) {
      warnings.push({ table: config.table, message: error.message });
      records[config.key] = config.single ? null : [];
      console.warn(
        `Encounter records query failed for ${config.table}:`,
        error.message,
      );
    }
  }

  if (Array.isArray(records.doctor_orders_exams)) {
    records.doctor_orders_exams = filterDischargeOrders(
      records.doctor_orders_exams,
    );
  }

  CHRONOLOGICAL_TABLE_KEYS.forEach((key) => {
    if (Array.isArray(records[key])) {
      records[key] = sortRowsByDateTime(records[key]);
    }
  });

  return { records, warnings };
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

async function getPatientList(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const name = String(req.query.name || "").trim();
    const facility = String(req.query.facility || "").trim();

    const conditions = [];
    const params = [];

    if (name) {
      const searchTerm = `%${name}%`;
      conditions.push(
        "(p.patlast LIKE ? OR p.patfirst LIKE ? OR p.patmiddle LIKE ? OR p.hpercode LIKE ?)",
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (facility) {
      conditions.push("p.hfhudcode = ?");
      params.push(facility);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const dataQuery = `
      SELECT
        p.hpercode,
        p.patlast,
        p.patfirst,
        p.patmiddle,
        p.patsuffix,
        p.patsex,
        p.patbdate,
        p.hfhudcode,
        p.patbplace,
        p.patcstat,
        p.natcode,
        p.relcode,
        p.pattelno,
        p.fatlast,
        p.fatmid,
        p.fatfirst,
        p.motlast,
        p.motfirt,
        p.motmid,
        p.patempstat,
        fh.hfhudname AS facility_name,
        a.brg AS bgycode,
        a.patstr,
        a.ctycode,
        a.provcode,
        a.patzip,
        b.bgyname,
        c.ctyname,
        pv.provname,
        r.regname
      FROM hperson p
      LEFT JOIN haddr a ON p.hpercode = a.hpercode
      LEFT JOIN hbrgy b ON a.brg = b.bgycode
      LEFT JOIN hcity c ON a.ctycode = c.ctycode
      LEFT JOIN hprov pv ON a.provcode = pv.provcode
      LEFT JOIN hregion r ON c.ctyreg = r.regcode
      LEFT JOIN fhud_hospital fh ON p.hfhudcode = fh.hfhudcode
      ${whereClause}
      ORDER BY p.patlast, p.patfirst
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM hperson p
      ${whereClause}
    `;

    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    res.json({
      ok: true,
      count: rows.length,
      filters: {
        name: name || null,
        facility: facility || null,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
      data: rows.map(mapPatientRow),
    });
  } catch (error) {
    next(error);
  }
}

async function getPatientHistory(req, res, next) {
  try {
    const hpercode = String(req.params.hpercode || "").trim();
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);

    const limit = Number.isNaN(parsedLimit)
      ? 50
      : Math.min(Math.max(parsedLimit, 1), 200);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    if (!hpercode) {
      return res.status(400).json({
        ok: false,
        message: "hpercode is required",
      });
    }

    let query = `
      SELECT
        a.enccode,
        a.hpercode,
        a.upicode,
        a.casenum,
        a.patage,
        a.newold,
        a.tacode,
        a.tscode,
        a.admdate,
        a.admtime,
        a.diagcode,
        a.admnotes,
        a.licno,
        a.diagfin,
        a.disnotes,
        a.admmode,
        a.admpreg,
        a.disdate,
        a.distime,
        a.dispcode,
        a.condcode,
        a.licnof,
        a.licncons,
        a.cbcode,
        a.dcspinst,
        a.admstat,
        a.admlock,
        a.datemod,
        a.updsw,
        a.confdl,
        a.admtxt,
        a.admclerk,
        a.licno2,
        a.licno3,
        a.licno4,
        a.licno5,
        a.patagemo,
        a.patagedy,
        a.patagehr,
        a.admphic,
        a.disnotice,
        a.treatment,
        a.hsepriv,
        a.licno6,
        a.licno7,
        a.licno8,
        a.licno9,
        a.licno10,
        a.itisind,
        a.entryby,
        a.pexpireddate,
        a.acis,
        a.watchid,
        a.lockby,
        a.lockdte,
        a.typadm,
        a.pho_hospital_number,
        a.nbind,
        a.foradmcode,
        a.is_smoker,
        a.smoker_cigarette_pack,
        a.deleted_at,
        a.created_at,
        a.discharge_by,
        e.fhud AS encounter_fhud,
        e.hpercode AS encounter_hpercode,
        e.encdate AS encounter_date,
        e.enctime AS encounter_time,
        e.toecode AS encounter_toecode,
        e.sopcode1 AS encounter_sopcode1,
        e.sopcode2 AS encounter_sopcode2,
        e.sopcode3 AS encounter_sopcode3,
        e.patinform AS encounter_patinform,
        e.patinfadd AS encounter_patinfadd,
        e.patinftel AS encounter_patinftel,
        e.enclock AS encounter_lock,
        e.datemod AS encounter_datemod,
        e.updsw AS encounter_updsw,
        e.confdl AS encounter_confdl,
        e.acctno AS encounter_acctno,
        e.entryby AS encounter_entryby,
        e.casetype AS encounter_casetype,
        e.tacode AS encounter_tacode,
        e.consentphie AS encounter_consentphie,
        e.cf4attendprov AS encounter_cf4attendprov
      FROM hadmlog a
      LEFT JOIN henctr e ON a.enccode = e.enccode
      WHERE a.hpercode = ?
    `;

    const params = [hpercode];

    if (startDate) {
      query += " AND a.admdate >= ?";
      params.push(startDate);
    }

    if (endDate) {
      query += " AND a.admdate <= ?";
      params.push(endDate);
    }

    query += " ORDER BY a.admdate DESC, a.admtime DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    let countQuery = "SELECT COUNT(*) AS total FROM hadmlog WHERE hpercode = ?";
    const countParams = [hpercode];

    if (startDate) {
      countQuery += " AND admdate >= ?";
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += " AND admdate <= ?";
      countParams.push(endDate);
    }

    const [rows] = await pool.query(query, params);
    const [countRows] = await pool.query(countQuery, countParams);
    const total = countRows[0]?.total || 0;

    res.json({
      ok: true,
      hpercode,
      count: rows.length,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

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

async function getBabyForm(req, res, next) {
  try {
    const enccode = String(req.query.enccode || "").trim();
    const babyHpercode = String(
      req.query.babyHpercode || req.query.baby_hpercode || req.query.hpercode || "",
    ).trim();

    if (!enccode && !babyHpercode) {
      return res.status(400).json({
        ok: false,
        message: "Either enccode or babyHpercode is required",
      });
    }

    const conditions = [];
    const params = [];

    if (enccode) {
      conditions.push("nb.enccode = ?");
      params.push(enccode);
    }

    if (babyHpercode) {
      conditions.push("nb.hpercode = ?");
      params.push(babyHpercode);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await pool.query(
      `SELECT
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
         COALESCE(NULLIF(hadm.pho_hospital_number, ''), hen.fhud) AS hospital_number,
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
       ${whereClause}
       ORDER BY nb.birthdate DESC
       LIMIT 1`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: "No baby form data found for the provided filter",
      });
    }

    res.json({
      ok: true,
      filters: {
        enccode: enccode || null,
        babyHpercode: babyHpercode || null,
      },
      data: mapBabyFormRow(rows[0]),
    });
  } catch (error) {
    next(error);
  }
}

async function searchPatients(req, res, next) {
  try {
    const { search, q, user, fhud, enccode, docointkey } = req.query;
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

    if (docointkey) {
      conditions.push("hdocord.docointkey = ?");
      params.push(docointkey);
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
      conditions.push("hdocord.entryby = ?");
      params.push(user);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countQuery = `SELECT COUNT(*) AS total FROM hdocord INNER JOIN henctr ON henctr.enccode = hdocord.enccode LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, params);

    const [rows] = await pool.query(
      `SELECT
         hdocord.enccode,
         henctr.fhud,
         hdocord.docointkey,
        hdocord.entryby AS user,
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
      pagination: { limit, offset, total },
      filters: {
        search: keyword || null,
        user: user || null,
        fhud: fhud || null,
        enccode: enccode || null,
        docointkey: docointkey || null,
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
  searchPatients,
  getPatientList,
  getPatientHistory,
  getPatientEncounterRecords,
  getBabyForm,
};
