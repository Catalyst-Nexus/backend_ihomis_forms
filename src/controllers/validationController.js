const pool = require('../config/db');
const supabase = require('../config/supabase');
const mysql = require('mysql2');

try {
  console.log('validationController loaded. supabase present:', !!supabase, 'hasFrom:', supabase && typeof supabase.from === 'function');
} catch (e) {
  console.warn('validationController: error checking supabase:', e && e.message);
}

// ===================== HELPERS =====================

async function resolveEncounterRecord(enccode) {
  if (!enccode) return { enccode: '', hpercode: '', toecode: '', matchedBy: 'none' };

  try {
    const [exactRows] = await pool.query('SELECT enccode, hpercode, toecode FROM henctr WHERE enccode = ? LIMIT 1', [enccode]);
    if (exactRows.length > 0) return { enccode: exactRows[0].enccode, hpercode: exactRows[0].hpercode || '', toecode: exactRows[0].toecode || '', matchedBy: 'exact' };
    const baseEnccode = enccode.split('/')[0];
    const [prefixRows] = await pool.query("SELECT enccode, hpercode, toecode FROM henctr WHERE enccode LIKE CONCAT(?, '/%') LIMIT 1", [baseEnccode]);
    if (prefixRows.length > 0) return { enccode: prefixRows[0].enccode, hpercode: prefixRows[0].hpercode || '', toecode: prefixRows[0].toecode || '', matchedBy: 'prefix' };
    return { enccode, hpercode: '', toecode: '', matchedBy: 'none' };
  } catch (error) {
    console.warn('resolveEncounterRecord fallback due to DB lookup error:', error && error.message ? error.message : error);
    return { enccode, hpercode: '', toecode: '', matchedBy: 'fallback' };
  }
}

async function resolveEncounterDetails(enccode) {
  try {
    const encounter = await resolveEncounterRecord(enccode);
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

async function loadFormValidations(formId) {
  if (!formId || !supabase || typeof supabase.from !== 'function') return [];
  const { data: mappings, error: mapErr } = await supabase.from('formvalidator').select('*').eq('formid', formId);
  if (mapErr) throw mapErr;
  const validationIds = (mappings || []).map((m) => m.validationid).filter(Boolean);
  if (validationIds.length === 0) return [];

  const { data: validations, error } = await supabase.from('validation').select('id, description, query, created_at').in('id', validationIds);
  if (error) throw error;

  const mappingsByValidationId = new Map((mappings || []).map((m) => [String(m.validationid), m]));
  return (validations || []).map((validation) => {
    const mapping = mappingsByValidationId.get(String(validation.id)) || null;
    return {
      ...validation,
      mappingId: mapping?.id || null,
    };
  });
}

function summarizeValidationResults(results = []) {
  const passed = results.filter((item) => item.success).length;
  const failed = results.length - passed;
  return {
    total: results.length,
    passed,
    failed,
    allPassed: failed === 0,
    missing: results.filter((item) => !item.success).map((item) => item.description).filter(Boolean),
  };
}

async function executeMappedValidation(validation, context) {
  const preparedQuery = prepareQuery(validation.query, context);
  let success = false;
  let info = null;

  try {
    const [rows] = await pool.query(preparedQuery);
    if (Array.isArray(rows)) {
      info = {
        rowCount: rows.length,
        sample: rows.slice(0, 10),
      };
      success = rows.length > 0;
    } else {
      info = { result: rows };
      success = Boolean(rows);
    }
  } catch (error) {
    info = { error: error.message };
    success = false;
  }

  return {
    validationId: validation.id,
    mappingId: validation.mappingId || null,
    description: validation.description || '',
    query: validation.query || '',
    preparedQuery,
    success,
    info,
  };
}

function prepareQuery(template, vars = {}) {
  if (!template) return template;
  const replacements = { enccode: vars.enccode || '', hpercode: vars.hpercode || '' };
  let q = template;
  q = q.replace(/(["'])\s*(\{\{\s*enccode\s*\}\}|\$ENCCODE\$)\s*\1/gi, () => mysql.escape(replacements.enccode));
  q = q.replace(/(["'])\s*(\{\{\s*hpercode\s*\}\}|\$HPERCODE\$)\s*\1/gi, () => mysql.escape(replacements.hpercode));
  q = q.replace(/\$ENCCODE\$|{{\s*enccode\s*}}|\{\{enccode\}\}/gi, () => mysql.escape(replacements.enccode));
  q = q.replace(/\$HPERCODE\$|{{\s*hpercode\s*}}|\{\{hpercode\}\}/gi, () => mysql.escape(replacements.hpercode));
  return q;
}

async function hasRecordByEnccode({ table, enccode, where = '', params = [] }) {
  try {
    const [rows] = await pool.query(`SELECT 1 FROM ${table} WHERE enccode = ?${where} LIMIT 1`, [enccode, ...params]);
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking ${table} by enccode:`, error);
    return false;
  }
}

async function hasRecordByHpercode({ table, hpercode, where = '', params = [] }) {
  try {
    // Special-case clearance checks stored in `hdocord` table: try to
    // detect service/status columns and ensure there are no pending rows.
    if (table === 'hdocord') {
      const serviceColumn = await findFirstExistingColumn('hdocord', ['proccode', 'orcode', 'ordertype', 'servicecode', 'deptcode']);
      const statusColumn = await findFirstExistingColumn('hdocord', ['procstat', 'ordstatus', 'status', 'clearance_status', 'iscleared']);

      // If schema does not expose service/status columns, return true to
      // avoid false blocking of discharge flows in legacy schemas.
      if (!serviceColumn || !statusColumn) return true;

      const [rows] = await pool.query(
        `SELECT 1
         FROM hdocord
         WHERE hpercode = ?
           AND COALESCE(${statusColumn}, '') NOT IN ('S', 'C', 'CLEARED', 'DONE', '1', 'Y')
         LIMIT 1`,
        [hpercode],
      );
      // If any pending rows exist the check fails; return true when none found.
      return rows.length === 0;
    }

    // Generic lookup by hpercode for other tables.
    const [rows] = await pool.query(`SELECT 1 FROM ${table} WHERE hpercode = ?${where} LIMIT 1`, [hpercode, ...params]);
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking ${table} by hpercode:`, error);
    return false;
  }
}

// Find the first existing column name from a list of candidate column names
// for a given table. Returns the column name or null.
async function findFirstExistingColumn(tableName, candidates = []) {
  try {
    for (const col of candidates) {
      const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ? LIMIT 1`,
        [tableName, col],
      );
      if (rows && rows.length > 0) return col;
    }
    return null;
  } catch (err) {
    console.error('findFirstExistingColumn error:', err);
    return null;
  }
}

// ❌ REMOVED: All hardcoded check* functions have been removed.
// ✅ USE: Dynamic validation via Supabase configuration instead.
// Validations are now defined in the 'validation' table and applied universally.

// ❌ REMOVED: Legacy hardcoded validation endpoints.
// These endpoints (validateAdmission, validateDischarge, getValidationDetails) are no longer needed.
// ✅ USE: /api/validation/run for all validations instead.

// ===================== SUPABASE-BACKED ENDPOINTS =====================

async function listHospitalForms(req, res, next) {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return res.status(200).json({ ok: true, forms: [], source: 'fallback', warning: 'Supabase client not configured on server' });
    }
    const { data, error } = await supabase.from('hospital_forms').select('id, description, component_name, is_active').order('id', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, forms: data || [], source: 'supabase' });
  } catch (error) {
    console.error('listHospitalForms failed, returning fallback response:', error && error.message ? error.message : error);
    res.status(200).json({ ok: true, forms: [], source: 'fallback', warning: error && error.message ? error.message : 'Supabase lookup failed' });
  }
}

async function listValidations(req, res, next) {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return res.status(200).json({ ok: true, validations: [], source: 'fallback', warning: 'Supabase client not configured on server' });
    }
    const { data, error } = await supabase.from('validation').select('id, description, query, created_at').order('id', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, validations: data || [], source: 'supabase' });
  } catch (error) {
    console.error('listValidations failed, returning fallback response:', error && error.message ? error.message : error);
    res.status(200).json({ ok: true, validations: [], source: 'fallback', warning: error && error.message ? error.message : 'Supabase lookup failed' });
  }
}

async function getFormValidations(req, res, next) {
  try {
    const { formId } = req.params;
    if (!formId) return res.status(400).json({ ok: false, error: 'formId required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const [form, validations] = await Promise.all([
      loadValidationForm(formId),
      loadFormValidations(formId),
    ]);
    res.json({
      ok: true,
      formId,
      form,
      validations,
      total: validations.length,
    });
  } catch (error) {
    next(error);
  }
}

async function createFormValidatorMapping(req, res, next) {
  try {
    const { formId, validationId } = req.body || {};
    if (!formId || !validationId) return res.status(400).json({ ok: false, error: 'formId and validationId required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data, error } = await supabase.from('formvalidator').insert([{ formid: formId, validationid: validationId }]).select('*').single();
    if (error) throw error;
    res.json({ ok: true, mapping: data });
  } catch (error) {
    next(error);
  }
}

async function createFormValidation(req, res, next) {
  try {
    const { formId, description, query } = req.body;
    if (!formId || !query) return res.status(400).json({ ok: false, error: 'formId and query required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data: validationData, error: valErr } = await supabase.from('validation').insert([{ description: description || null, query }]).select().single();
    if (valErr) throw valErr;
    const { data: mappingData, error: mapErr } = await supabase.from('formvalidator').insert([{ formid: formId, validationid: validationData.id }]).select().single();
    if (mapErr) throw mapErr;
    res.json({ ok: true, validation: validationData, mapping: mappingData });
  } catch (error) {
    next(error);
  }
}

async function deleteFormValidation(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: 'mapping id required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { error } = await supabase.from('formvalidator').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true, deletedMappingId: id });
  } catch (error) {
    next(error);
  }
}

async function runFormValidations(req, res, next) {
  try {
    const { formId, enccode: inputEnccode } = req.body || {};
    if (!formId || !inputEnccode) return res.status(400).json({ ok: false, error: 'formId and enccode required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const [form, validationContext] = await Promise.all([
      loadValidationForm(formId),
      resolveEncounterDetails(inputEnccode),
    ]);

    const validations = await loadFormValidations(formId);
    const context = {
      enccode: validationContext.encounter.enccode,
      hpercode: validationContext.encounter.hpercode,
      toecode: validationContext.encounterType,
      matchedBy: validationContext.encounter.matchedBy,
      phicclaim: validationContext.henctr?.phicclaim || '',
    };

    const results = [];
    for (const validation of validations) {
      results.push(await executeMappedValidation(validation, context));
    }

    const summary = summarizeValidationResults(results);

    res.json({
      ok: true,
      formId,
      form,
      encounter: {
        requestedEnccode: inputEnccode,
        resolvedEnccode: validationContext.encounter.enccode,
        hpercode: validationContext.encounter.hpercode,
        toecode: validationContext.encounterType,
        matchedBy: validationContext.encounter.matchedBy,
        henctr: validationContext.henctr,
        admissionLog: validationContext.admissionLog,
        dischargeLog: validationContext.dischargeLog,
      },
      validationContext: {
        enccode: context.enccode,
        hpercode: context.hpercode,
        toecode: context.toecode,
        matchedBy: context.matchedBy,
        phicclaim: context.phicclaim,
      },
      validations: results,
      results,
      summary,
    });
  } catch (error) {
    next(error);
  }
}

// ===================== UNIVERSAL VALIDATION API =====================
// Single endpoint that validates any enccode against any validations
// This is schema-agnostic and purely data-driven from Supabase

async function validateEncounter(req, res, next) {
  try {
    const { enccode: inputEnccode, validationIds = [] } = req.body || {};
    if (!inputEnccode) return res.status(400).json({ ok: false, error: 'enccode required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });

    const validationContext = await resolveEncounterDetails(inputEnccode);
    const context = {
      enccode: validationContext.encounter.enccode,
      hpercode: validationContext.encounter.hpercode,
      toecode: validationContext.encounterType,
      matchedBy: validationContext.encounter.matchedBy,
      phicclaim: validationContext.henctr?.phicclaim || '',
    };

    // If specific validationIds provided, load only those
    let validations = [];
    if (validationIds.length > 0) {
      const { data, error } = await supabase
        .from('validation')
        .select('id, description, query, created_at')
        .in('id', validationIds);
      if (error) throw error;
      validations = data || [];
    } else {
      // Otherwise, return validation context without running any
      return res.json({
        ok: true,
        enccode: inputEnccode,
        encounter: {
          requestedEnccode: inputEnccode,
          resolvedEnccode: validationContext.encounter.enccode,
          hpercode: validationContext.encounter.hpercode,
          toecode: validationContext.encounterType,
          matchedBy: validationContext.encounter.matchedBy,
        },
        validationContext: context,
        results: [],
        summary: { total: 0, passed: 0, failed: 0, allPassed: true, missing: [] },
      });
    }

    const results = [];
    for (const validation of validations) {
      results.push(await executeMappedValidation(validation, context));
    }

    const summary = summarizeValidationResults(results);

    res.json({
      ok: true,
      enccode: inputEnccode,
      encounter: {
        requestedEnccode: inputEnccode,
        resolvedEnccode: validationContext.encounter.enccode,
        hpercode: validationContext.encounter.hpercode,
        toecode: validationContext.encounterType,
        matchedBy: validationContext.encounter.matchedBy,
      },
      validationContext: context,
      results,
      summary,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listHospitalForms,
  listValidations,
  getFormValidations,
  createFormValidatorMapping,
  createFormValidation,
  deleteFormValidation,
  runFormValidations,
  validateEncounter,
};
