const pool = require('../config/db');
const mysql = require('mysql2');
const { mapPatientRow } = require('../utils/dbHelpers');

// ===================== PERFORMANCE CACHE =====================
// Cache for schema lookups to avoid repeated column existence checks
const schemaCache = {};
const CACHE_TTL = 3600000; // 1 hour in milliseconds

function getCachedColumns(tableName) {
  const entry = schemaCache[tableName];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCachedColumns(tableName, data) {
  schemaCache[tableName] = { data, timestamp: Date.now() };
}

// ===================== HELPERS =====================

async function resolveEncounterRecord(enccode, hpercode = '') {
  const inputHpercode = String(hpercode || '').trim();
  if (!enccode && !inputHpercode) return { enccode: '', hpercode: '', toecode: '', matchedBy: 'none' };

  try {
    // Normalize enccode: extract base part before any "/" or other separators
    // e.g., "000502700000000000210705/24/202521:44:48" → "000502700000000000210705"
    const baseEnccode = String(enccode).split('/')[0].trim();

    if (!baseEnccode && inputHpercode) {
      const [latestRows] = await pool.query(
        `
          SELECT
            a.enccode,
            a.hpercode,
            a.toecode,
            a.phicclaim
          FROM henctr a
          LEFT JOIN hadmlog b ON b.enccode = a.enccode
          WHERE a.hpercode = ?
          ORDER BY b.admdate DESC, b.admtime DESC, a.enccode DESC
          LIMIT 1
        `,
        [inputHpercode],
      );

      if (latestRows.length > 0) {
        return {
          enccode: latestRows[0].enccode,
          hpercode: latestRows[0].hpercode || inputHpercode,
          toecode: latestRows[0].toecode || '',
          matchedBy: 'latest-hpercode',
        };
      }

      return { enccode: '', hpercode: inputHpercode, toecode: '', matchedBy: 'none' };
    }
    
    if (!baseEnccode) {
      return { enccode: '', hpercode: '', toecode: '', matchedBy: 'none' };
    }

    // Try exact match with base enccode
    const [exactRows] = await pool.query('SELECT enccode, hpercode, toecode FROM henctr WHERE enccode = ? LIMIT 1', [baseEnccode]);
    if (exactRows.length > 0) {
      return { 
        enccode: exactRows[0].enccode, 
        hpercode: exactRows[0].hpercode || '', 
        toecode: exactRows[0].toecode || '', 
        matchedBy: 'exact' 
      };
    }

    // Try prefix match: look for records starting with base enccode
    const [prefixRows] = await pool.query(
      "SELECT enccode, hpercode, toecode FROM henctr WHERE enccode LIKE CONCAT(?, '%') LIMIT 1", 
      [baseEnccode]
    );
    if (prefixRows.length > 0) {
      return { 
        enccode: prefixRows[0].enccode, 
        hpercode: prefixRows[0].hpercode || '', 
        toecode: prefixRows[0].toecode || '', 
        matchedBy: 'prefix' 
      };
    }

    // Return base enccode if found
    return { enccode: baseEnccode, hpercode: inputHpercode, toecode: '', matchedBy: 'none' };
  } catch (error) {
    console.warn('resolveEncounterRecord error:', error && error.message ? error.message : error);
    // Return base enccode on error
    const baseEnccode = String(enccode).split('/')[0].trim();
    return { enccode: baseEnccode || enccode, hpercode: inputHpercode, toecode: '', matchedBy: 'fallback' };
  }
}

async function resolveEncounterDetails(enccode, hpercode = '') {
  try {
    const encounter = await resolveEncounterRecord(enccode, hpercode);
    if (!encounter.enccode) {
      return {
        encounter,
        henctr: null,
        admissionLog: null,
        dischargeLog: null,
        encounterType: '',
      };
    }

    const [henctrRows] = await pool.query(
      'SELECT enccode, hpercode, toecode, phicclaim FROM henctr WHERE enccode = ? LIMIT 1',
      [encounter.enccode],
    );

    const henctr = henctrRows[0] || null;
    const encounterType = henctr?.toecode || encounter.toecode || '';

    let admissionLog = null;
    let dischargeLog = null;

    if (encounterType === 'ADM') {
      const [admRows] = await pool.query(
        'SELECT admdate, disdate, tscode FROM hadmlog WHERE enccode = ? LIMIT 1',
        [encounter.enccode],
      );
      admissionLog = admRows[0] || null;
    } else if (encounterType === 'ER' || encounterType === 'ERADM') {
      const [erRows] = await pool.query(
        'SELECT erdate, erdtedis FROM herlog WHERE enccode = ? LIMIT 1',
        [encounter.enccode],
      );
      admissionLog = erRows[0] || null;
    } else if (encounterType === 'OPD') {
      const [opdRows] = await pool.query(
        'SELECT opddate, opddtedis FROM hopdlog WHERE enccode = ? LIMIT 1',
        [encounter.enccode],
      );
      admissionLog = opdRows[0] || null;
    }

    if (encounterType === 'ADM') {
      const [disRows] = await pool.query(
        'SELECT dodate, orcode, enccode FROM hdocord WHERE orcode = \'DISCH\' AND enccode = ? LIMIT 1',
        [encounter.enccode],
      );
      dischargeLog = disRows[0] || null;
    }

    return {
      encounter,
      henctr,
      admissionLog,
      dischargeLog,
      encounterType,
    };
  } catch (error) {
    console.warn('resolveEncounterDetails fallback due to DB lookup error:', error && error.message ? error.message : error);
    return {
      encounter: { enccode: enccode || '', hpercode: '', toecode: '', matchedBy: 'fallback' },
      henctr: null,
      admissionLog: null,
      dischargeLog: null,
      encounterType: '',
    };
  }
}

async function fetchPatientDetails(hpercode) {
  const normalizedHpercode = String(hpercode || '').trim();
  if (!normalizedHpercode) return null;

  const [rows] = await pool.query(
    `
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
        p.bldtype,
        p.patempstat,
        fh.hfhudname AS facility_name,
        a.brg AS bgycode,
        a.patstr AS street,
        a.ctycode AS city_code,
        a.provcode AS province_code,
        a.patzip AS zip_code,
        b.bgyname,
        c.ctyname,
        pv.provname,
        r.regname,
        CONCAT_WS(', ', a.patstr, b.bgyname, c.ctyname, pv.provname, r.regname, a.patzip) AS patient_address,
        (
          SELECT ht.pattel
          FROM htelep ht
          WHERE ht.hpercode = p.hpercode
          LIMIT 1
        ) AS telephone_number,
        (SELECT h.casenum FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS case_number,
        (SELECT h.patage FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS age,
        (SELECT h.admdate FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS admission_date,
        (SELECT h.disdate FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS discharge_date,
        (SELECT h.admtxt FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS chief_complaint,
        (SELECT h.admnotes FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS admission_diagnosis,
        (
          SELECT CONCAT_WS(' ', hp.firstname, hp.middlename, hp.lastname)
          FROM hadmlog h
          LEFT JOIN hprovider pr ON h.licno = pr.licno
          LEFT JOIN hpersonal hp ON pr.employeeid = hp.employeeid
          WHERE h.hpercode = p.hpercode
          LIMIT 1
        ) AS requesting_physician,
        (
          SELECT ph.phicnum
          FROM hphiclog ph
          WHERE ph.hpercode = p.hpercode
          LIMIT 1
        ) AS health_number,
        (
          SELECT rm.rmname
          FROM hpatroom pr
          LEFT JOIN hroom rm ON pr.rmintkey = rm.rmintkey
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS room_name,
        (
          SELECT bd.bdname
          FROM hpatroom pr
          LEFT JOIN hbed bd ON pr.bdintkey = bd.bdintkey
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS bed_name,
        (
          SELECT wd.wardname
          FROM hpatroom pr
          LEFT JOIN hward wd ON pr.wardcode = wd.wardcode
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS ward_name,
        (SELECT vs.vsbp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS blood_pressure,
        (SELECT vs.vstemp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS temperature,
        (SELECT vs.vspulse FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS pulse,
        (SELECT vs.vsresp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS resp,
        (SELECT vs.o2sats FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS o2sats,
        (SELECT vs.vsweight FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS weight,
        (SELECT vs.vsheight FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS height,
        (SELECT vs.vsbmi FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS bmi,
        (SELECT vs.vsbmicat FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS bmi_category,
        (SELECT h.disnotes FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS discharge_diagnosis,
        (SELECT h.dispcode FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS disposition,
        (SELECT h.condcode FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS 'condition',
        (SELECT h.newold FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS type_of_admission,
        (SELECT vs.fetal_heart_rate FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS fetal_heart_rate,
        (
          SELECT CONCAT_WS(' ', hp.firstname, hp.middlename, hp.lastname)
          FROM hadmlog h
          LEFT JOIN hpersonal hp ON h.admclerk = hp.employeeid
          WHERE h.hpercode = p.hpercode
          LIMIT 1
        ) AS admitting_clerk
      FROM hperson p
      LEFT JOIN haddr a ON p.hpercode = a.hpercode
      LEFT JOIN hbrgy b ON a.brg = b.bgycode
      LEFT JOIN hcity c ON a.ctycode = c.ctycode
      LEFT JOIN hprov pv ON a.provcode = pv.provcode
      LEFT JOIN hregion r ON c.ctyreg = r.regcode
      LEFT JOIN fhud_hospital fh ON p.hfhudcode = fh.hfhudcode
      WHERE p.hpercode = ?
      LIMIT 1
    `,
    [normalizedHpercode],
  );

  const row = rows[0] || null;
  if (!row) return null;

  return {
    ...mapPatientRow(row),
    rawData: row,
  };
}

async function loadValidationForm(formId) {
  if (!formId || !supabase || typeof supabase.from !== 'function') return null;
  const { data, error } = await supabase
    .from('hospital_forms')
    .select('id, description, component_name, is_active')
    .eq('id', formId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function replaceValidationPlaceholder(query, placeholder, value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return query;

  const escapedValue = mysql.escape(normalizedValue);
  const rawEscapedValue = escapedValue.slice(1, -1);
  const placeholderName = String(placeholder || '').trim();

  if (!placeholderName) return query;

  let result = query;

  const quotedPatterns = [
    new RegExp(`(['"])\\{\\{${placeholderName}\\}\\}\\1`, 'gi'),
    new RegExp(`(['"])\\{${placeholderName}\\}\\1`, 'gi'),
    new RegExp(`(['"])\\$${placeholderName.toUpperCase()}\\$\\1`, 'gi'),
  ];

  quotedPatterns.forEach((pattern) => {
    result = result.replace(pattern, (match, quote) => `${quote}${rawEscapedValue}${quote}`);
  });

  const barePattern = new RegExp(
    `\\{\\{${placeholderName}\\}\\}|\\{${placeholderName}\\}|\\$${placeholderName.toUpperCase()}\\$`,
    'gi',
  );

  return result.replace(barePattern, escapedValue);
}

// Find the first existing column name from a list of candidate column names
// for a given table. Returns the column name or null.
async function findFirstExistingColumn(tableName, candidates = []) {
    // Check cache first
    const cached = getCachedColumns(tableName);
    if (cached) return cached;

  try {
    for (const col of candidates) {
      const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ? LIMIT 1`,
        [tableName, col],
      );
      if (rows && rows.length > 0) return col;
    }
    const result = null;
    setCachedColumns(tableName, result);
    return result;
  } catch (err) {
    console.error('findFirstExistingColumn error:', err);
    return null;
  }
}

// ===================== CORE VALIDATION ENDPOINTS =====================

/**
 * POST /api/validation/data
 * Returns encounter data needed for frontend validation
 * Input: { enccode }
 * Output: { ok, data: { enccode, hpercode, toecode, matchedBy, phicclaim, henctr, admissionLog, dischargeLog } }
 */
async function getValidationData(req, res, next) {
  try {
    const { enccode: inputEnccode, hpercode: inputHpercode } = req.body || {};
    if (!inputEnccode && !inputHpercode) {
      return res.status(400).json({ ok: false, error: 'enccode or hpercode required' });
    }

    const validationContext = await resolveEncounterDetails(inputEnccode, inputHpercode);
    const resolvedHpercode = validationContext.encounter.hpercode || String(inputHpercode || '').trim();
    const patient = await fetchPatientDetails(resolvedHpercode);
    const context = {
      enccode: validationContext.encounter.enccode,
      hpercode: resolvedHpercode,
      toecode: validationContext.encounterType,
      matchedBy: validationContext.encounter.matchedBy,
      phicclaim: validationContext.henctr?.phicclaim || '',
    };

    res.json({
      ok: true,
      data: {
        enccode: context.enccode,
        hpercode: context.hpercode,
        toecode: context.toecode,
        matchedBy: context.matchedBy,
        phicclaim: context.phicclaim,
        patient,
        encounter: {
          requestedEnccode: inputEnccode,
          requestedHpercode: inputHpercode || '',
          resolvedEnccode: validationContext.encounter.enccode,
          resolvedHpercode,
        },
        validationContext: {
          encounter: validationContext.encounter,
          henctr: validationContext.henctr,
          patient,
        },
        henctr: validationContext.henctr,
        admissionLog: validationContext.admissionLog,
        dischargeLog: validationContext.dischargeLog,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ===================== VALIDATION QUERY EXECUTION ENDPOINT =====================
// Executes a prepared validation query and returns if results exist
// Called by frontend after fetching validation rules and encounter data

async function executeValidationQuery(req, res, next) {
  try {
    const { query, enccode, hpercode, validationId, description } = req.body || {};
    if (!query) {
      return res.status(400).json({ ok: false, error: 'query required' });
    }

    // Keep the original enccode first because some encounter tables store the
    // full token, including the timestamp suffix. Fall back to the normalized
    // base only if the first attempt returns no rows.
    const originalEnccode = String(enccode || '').trim();
    const normalizedEnccode = originalEnccode ? originalEnccode.split('/')[0].trim() : '';

    const buildProcessedQuery = (encValue) => {
      let processedQuery = query;
      processedQuery = replaceValidationPlaceholder(processedQuery, 'enccode', encValue);
      processedQuery = replaceValidationPlaceholder(processedQuery, 'hpercode', hpercode);
      return processedQuery;
    };

    const queryCandidates = [];
    if (originalEnccode) {
      queryCandidates.push({
        source: 'original',
        enccodeValue: originalEnccode,
        processedQuery: buildProcessedQuery(originalEnccode),
      });
    }
    if (normalizedEnccode && normalizedEnccode !== originalEnccode) {
      queryCandidates.push({
        source: 'normalized',
        enccodeValue: normalizedEnccode,
        processedQuery: buildProcessedQuery(normalizedEnccode),
      });
    }

    if (queryCandidates.length === 0) {
      queryCandidates.push({
        source: 'empty',
        enccodeValue: '',
        processedQuery: buildProcessedQuery(''),
      });
    }

    let executionResult = null;
    let lastError = null;

    for (const candidate of queryCandidates) {
      try {
        console.log('Executing validation query:', {
          validationId,
          description,
          originalEnccode: originalEnccode,
          normalizedEnccode: normalizedEnccode,
          hpercode,
          candidateSource: candidate.source,
          query: query,
          processedQuery: candidate.processedQuery,
        });

        console.log('About to execute processed query:', candidate.processedQuery);
        const [rows] = await pool.query(candidate.processedQuery);

        const success = Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
        const info = {
          rowCount: Array.isArray(rows) ? rows.length : 0,
          sample: Array.isArray(rows) ? rows.slice(0, 5) : rows,
          usedEnccode: candidate.enccodeValue,
          enccodeSource: candidate.source,
        };

        console.log('Validation result:', {
          validationId,
          description,
          candidateSource: candidate.source,
          success,
          rowCount: info.rowCount,
          hasSample: !!info.sample?.length,
          firstRow: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
        });

        executionResult = {
          ok: true,
          validationId: validationId || null,
          description: description || '',
          query: candidate.processedQuery,
          success,
          info,
        };

        if (success || candidate.source === 'normalized' || queryCandidates.length === 1) {
          break;
        }

        // If the original enccode returns no rows, try the normalized one.
        if (candidate.source === 'original') {
          continue;
        }

      } catch (error) {
        lastError = error;
        console.warn('Validation query candidate failed:', {
          validationId,
          description,
          candidateSource: candidate.source,
          error: error && error.message ? error.message : error,
        });
      }
    }

    if (executionResult) {
      return res.json(executionResult);
    }

    throw lastError || new Error('Validation query execution failed');
  } catch (error) {
    console.error('executeValidationQuery error:', error);
    res.status(400).json({
      ok: false,
      error: error.message || 'Query execution failed',
      details: error.message,
    });
  }
}


module.exports = {
  getValidationData,
  executeValidationQuery,
};
