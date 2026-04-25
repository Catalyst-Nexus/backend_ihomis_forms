const pool = require('../config/db');

function escapeIdentifier(identifier) {
  return String(identifier).replace(/`/g, '``');
}

function mapSex(sexCode) {
  if (!sexCode) return '';
  const code = String(sexCode).toUpperCase();
  if (code === 'M' || code === 'MALE' || code === '1') return 'male';
  if (code === 'F' || code === 'FEMALE' || code === '2') return 'female';
  return 'unknown';
}

function formatDate(date) {
  if (!date) return '';
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

function mapPatientRow(row) {
  return {
    id: row.hpercode || '',
    hpercode: row.hpercode || '',
    first_name: row.patfirst || '',
    middle_name: row.patmiddle || '',
    last_name: row.patlast || '',
    ext_name: row.patsuffix || '',
    sex: mapSex(row.patsex),
    birth_date: formatDate(row.patbdate),
    facility_code: row.hfhudcode || '',
    facility_name: row.facility_name || '',
    created_at: '',
    brgy: row.bgycode || '',
    brgy_name: row.bgyname || '',
    street: row.patstr || '',
    city_code: row.ctycode || '',
    city_name: row.ctyname || '',
    province_code: row.provcode || '',
    province_name: row.provname || '',
    region_name: row.regname || '',
    zip_code: row.patzip || '',
  };
}

const RECORD_CONFIGS = [
  { key: 'other_details', table: 'hvsothr' },
  { key: 'vital_signs', table: 'hvitalsign', single: true },
  { key: 'medical_history', table: 'hmrhisto' },
  { key: 'signs_and_symptoms', table: 'hsignsymptoms' },
  { key: 'symptom_physical_others', table: 'hpesignsothers' },
  { key: 'physical_exam', table: 'hphyexam' },
  { key: 'system_review', table: 'hmrsrev' },
  { key: 'ward_course', table: 'hcrsward' },
  { key: 'diagnoses', table: 'hencdiag' },
  { key: 'doctor_orders_medication', table: 'hrxo' },
  { key: 'medical_supplies', table: 'hrqd' },
  { key: 'doctor_orders_exams', table: 'hdocord', sql: "SELECT * FROM hdocord WHERE enccode = ? AND estatus = 'S'" },
];

const CHRONOLOGICAL_TABLE_KEYS = new Set([
  'ward_course',
  'doctor_orders_medication',
  'medical_supplies',
  'doctor_orders_exams',
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

  const combined = [value, time].filter(Boolean).join(' ');
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
  const dateKey = findMatchingKey(keys, (name) => name.includes('date'));
  if (!dateKey) {
    return rows;
  }

  const timeKey = findMatchingKey(keys, (name) => name.includes('time'));

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
  const descriptionKey = findMatchingKey(keys, (name) => name.includes('desc'));
  if (!descriptionKey) {
    return rows;
  }

  return rows.filter((row) => !DISCHARGE_REGEX.test(String(row[descriptionKey] ?? '').trim()));
}

async function fetchEncounterRecords(enccode) {
  const records = createEmptyRecordBucket();
  const warnings = [];

  for (const config of RECORD_CONFIGS) {
    const sql = config.sql ?? `SELECT * FROM ${config.table} WHERE enccode = ?`;
    try {
      const [rows] = await pool.query(sql, [enccode]);
      records[config.key] = config.single ? rows[0] ?? null : rows;
    } catch (error) {
      warnings.push({ table: config.table, message: error.message });
      records[config.key] = config.single ? null : [];
      console.warn(`Encounter records query failed for ${config.table}:`, error.message);
    }
  }

  if (Array.isArray(records.doctor_orders_exams)) {
    records.doctor_orders_exams = filterDischargeOrders(records.doctor_orders_exams);
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
    const [rows] = await pool.query('SELECT 1 AS ok');

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
    const [rows] = await pool.query('SHOW TABLES');

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
    const [dbRows] = await pool.query('SELECT DATABASE() AS databaseName');
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
        `SELECT \`${columnName}\` AS facilityCode FROM \`${tableName}\` WHERE \`${columnName}\` IS NOT NULL LIMIT 1`
      );

      if (rows[0]?.facilityCode !== undefined && rows[0]?.facilityCode !== null && rows[0]?.facilityCode !== '') {
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
      note: 'Database is not reachable yet. configuredDatabase is shown from environment only.',
    });
  }
}

async function getHenctrInfo(req, res, next) {
  try {
    const { enccode, fhud } = req.query;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);

    const limit = Number.isNaN(parsedLimit) ? 100 : Math.min(Math.max(parsedLimit, 1), 500);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

    const conditions = [];
    const params = [];

    if (enccode) {
      conditions.push('enccode = ?');
      params.push(enccode);
    }

    if (fhud) {
      conditions.push('fhud = ?');
      params.push(fhud);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT enccode, fhud
       FROM henctr
       ${whereClause}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
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

async function getPatientList(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const name = String(req.query.name || '').trim();
    const facility = String(req.query.facility || '').trim();

    const conditions = [];
    const params = [];

    if (name) {
      const searchTerm = `%${name}%`;
      conditions.push('(p.patlast LIKE ? OR p.patfirst LIKE ? OR p.patmiddle LIKE ? OR p.hpercode LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (facility) {
      conditions.push('p.hfhudcode = ?');
      params.push(facility);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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
    const hpercode = String(req.params.hpercode || '').trim();
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);

    const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), 200);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    if (!hpercode) {
      return res.status(400).json({
        ok: false,
        message: 'hpercode is required',
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
      query += ' AND a.admdate >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND a.admdate <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY a.admdate DESC, a.admtime DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    let countQuery = 'SELECT COUNT(*) AS total FROM hadmlog WHERE hpercode = ?';
    const countParams = [hpercode];

    if (startDate) {
      countQuery += ' AND admdate >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ' AND admdate <= ?';
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
    const hpercode = String(req.params.hpercode || '').trim();
    const enccode = String(req.params.enccode || '').trim();

    if (!hpercode || !enccode) {
      return res.status(400).json({
        ok: false,
        message: 'Both hpercode and enccode are required',
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

module.exports = {
  dbStatus,
  listTables,
  dbInfo,
  getHenctrInfo,
  getPatientList,
  getPatientHistory,
  getPatientEncounterRecords,
};
