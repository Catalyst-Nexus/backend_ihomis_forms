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
  const [exactRows] = await pool.query('SELECT enccode, hpercode, toecode FROM henctr WHERE enccode = ? LIMIT 1', [enccode]);
  if (exactRows.length > 0) return { enccode: exactRows[0].enccode, hpercode: exactRows[0].hpercode || '', toecode: exactRows[0].toecode || '', matchedBy: 'exact' };
  const baseEnccode = enccode.split('/')[0];
  const [prefixRows] = await pool.query("SELECT enccode, hpercode, toecode FROM henctr WHERE enccode LIKE CONCAT(?, '/%') LIMIT 1", [baseEnccode]);
  if (prefixRows.length > 0) return { enccode: prefixRows[0].enccode, hpercode: prefixRows[0].hpercode || '', toecode: prefixRows[0].toecode || '', matchedBy: 'prefix' };
  return { enccode, hpercode: '', toecode: '', matchedBy: 'none' };
}

async function resolveEncounterDetails(enccode) {
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

async function checkAdmissionVitalSigns(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hvitalsign', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hvitalsign', hpercode });
}

async function checkAdmissionBMI(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hbmi', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hbmi', hpercode });
}

async function checkAdmissionHistory(enccode, histype, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hmrhisto', enccode, where: ' AND histype = ?', params: [histype] });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hmrhisto', hpercode, where: ' AND histype = ?', params: [histype] });
}

async function checkAdmissionHistoryOB(enccode, hpercode = '') {
  const [admLog] = await pool.query('SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1', [enccode]);
  if (admLog.length === 0) return false;
  if (admLog[0].tscode === 'S0005') {
    const foundByEnccode = await hasRecordByEnccode({ table: 'hmrhistoob', enccode, where: ' AND obg IS NOT NULL AND oblmp IS NOT NULL' });
    if (foundByEnccode) return true;
    return await hasRecordByHpercode({ table: 'hmrhistoob', hpercode, where: ' AND obg IS NOT NULL AND oblmp IS NOT NULL' });
  }
  return true;
}

async function checkAdmissionPrenatal(enccode, hpercode = '') {
  const [admLog] = await pool.query('SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1', [enccode]);
  if (admLog.length === 0) return false;
  if (admLog[0].tscode === 'S0005') {
    const foundByEnccode = await hasRecordByEnccode({ table: 'hprenatal', enccode, where: ' AND mcp IS NOT NULL AND prenataldte2 IS NOT NULL AND prenataldte3 IS NOT NULL AND prenataldte4 IS NOT NULL AND expectdeliverydte IS NOT NULL' });
    if (foundByEnccode) return true;
    return await hasRecordByHpercode({ table: 'hprenatal', hpercode, where: ' AND mcp IS NOT NULL AND prenataldte2 IS NOT NULL AND prenataldte3 IS NOT NULL AND prenataldte4 IS NOT NULL AND expectdeliverydte IS NOT NULL' });
  }
  return true;
}

async function checkAdmissionPertinentSignSymptoms(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hpertsign', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hpertsign', hpercode });
}

async function checkAdmissionPhysicalExam(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hphyexam', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hphyexam', hpercode });
}

async function checkAdmissionSystemReview(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hsysrev', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hsysrev', hpercode });
}

async function checkAdmissionCourseWard(enccode, hpercode = '') {
  const foundByEnccode = await hasRecordByEnccode({ table: 'hcrsward', enccode });
  if (foundByEnccode) return true;
  return await hasRecordByHpercode({ table: 'hcrsward', hpercode });
}

async function checkCourseInTheWardDischarge(enccode) {
  const [enctr] = await pool.query('SELECT toecode FROM henctr WHERE enccode = ? LIMIT 1', [enccode]);
  if (enctr.length === 0) return false;
  const { toecode } = enctr[0];
  let admLog;
  if (toecode === 'ADM') {
    [admLog] = await pool.query('SELECT admdate, disdate FROM hadmlog WHERE enccode = ? LIMIT 1', [enccode]);
  } else if (toecode === 'ER' || toecode === 'ERADM') {
    [admLog] = await pool.query('SELECT erdate, erdtedis FROM herlog WHERE enccode = ? LIMIT 1', [enccode]);
  } else if (toecode === 'OPD') {
    [admLog] = await pool.query('SELECT opddate, opddtedis FROM hopdlog WHERE enccode = ? LIMIT 1', [enccode]);
  } else {
    return false;
  }
  if (admLog.length === 0) return false;
  let admDate, disDate;
  if (toecode === 'ADM') {
    admDate = new Date(admLog[0].admdate);
    disDate = admLog[0].disdate ? new Date(admLog[0].disdate) : null;
  } else if (toecode === 'ER' || toecode === 'ERADM') {
    admDate = new Date(admLog[0].erdate);
    disDate = admLog[0].erdtedis ? new Date(admLog[0].erdtedis) : null;
  } else {
    admDate = new Date(admLog[0].opddate);
    disDate = admLog[0].opddtedis ? new Date(admLog[0].opddtedis) : null;
  }
  const finalDate = disDate || new Date();
  const daysDifference = Math.ceil((finalDate - admDate) / (1000 * 60 * 60 * 24));
  for (let i = 0; i <= daysDifference; i++) {
    const checkDate = new Date(admDate);
    checkDate.setDate(checkDate.getDate() + i);
    const dateStr = checkDate.toISOString().split('T')[0];
    const [courseEntry] = await pool.query('SELECT * FROM hcrsward WHERE enccode = ? AND DATE(dtetake) = ? LIMIT 1', [enccode, dateStr]);
    if (courseEntry.length === 0) return false;
  }
  return true;
}

async function checkDischargeOrder(enccode) {
  const [enctr] = await pool.query('SELECT toecode FROM henctr WHERE enccode = ? LIMIT 1', [enccode]);
  if (enctr.length === 0) return null;
  const { toecode } = enctr[0];
  if (toecode === 'ADM') {
    const [rows] = await pool.query("SELECT dodate FROM hdocord WHERE orcode = 'DISCH' AND enccode = ? LIMIT 1", [enccode]);
    return rows.length > 0 ? rows[0].dodate : null;
  }
  return 'Patient Done';
}

async function checkFinalDiagnosis(enccode) {
  const [rows] = await pool.query(`SELECT diagtext FROM hencdiag WHERE tdcode = 'FINDX' AND enccode = ? AND primediag = 'Y' LIMIT 1`, [enccode]);
  return rows.length > 0 ? rows[0].diagtext : null;
}

async function checkICDCode(enccode) {
  const [rows] = await pool.query(`SELECT diagcode FROM hencdiag WHERE tdcode = 'FINDX' AND enccode = ? LIMIT 1`, [enccode]);
  return rows.length > 0 ? rows[0].diagcode : null;
}

async function checkPhicStatus(enccode) {
  const [henctr] = await pool.query('SELECT phicclaim FROM henctr WHERE enccode = ? LIMIT 1', [enccode]);
  if (henctr.length === 0) return false;
  if (henctr[0].phicclaim === 'Y') {
    const [patCon] = await pool.query('SELECT nbb FROM hpatcon WHERE enccode = ? LIMIT 1', [enccode]);
    if (patCon.length > 0) return patCon[0].nbb === 'Y';
    return false;
  }
  return false;
}

// ===================== LEGACY VALIDATION ENDPOINTS =====================

async function validateAdmission(req, res, next) {
  try {
    const { enccode: inputEnccode } = req.params;
    const encounter = await resolveEncounterRecord(inputEnccode);
    const hpercode = encounter.hpercode;
    const results = {
      enccode: encounter.enccode,
      vitalSigns: await checkAdmissionVitalSigns(encounter.enccode, hpercode),
      bmi: await checkAdmissionBMI(encounter.enccode, hpercode),
      historyGDPPR: await checkAdmissionHistory(encounter.enccode, 'GDPPR', hpercode),
      historyCOMPL: await checkAdmissionHistory(encounter.enccode, 'COMPL', hpercode),
      historyPRHIS: await checkAdmissionHistory(encounter.enccode, 'PRHIS', hpercode),
      historyPAHIS: await checkAdmissionHistory(encounter.enccode, 'PAHIS', hpercode),
      historyOCENV: await checkAdmissionHistory(encounter.enccode, 'OCENV', hpercode),
      historyFAHIS: await checkAdmissionHistory(encounter.enccode, 'FAHIS', hpercode),
      historyDRTHE: await checkAdmissionHistory(encounter.enccode, 'DRTHE', hpercode),
      historyALCOH: await checkAdmissionHistory(encounter.enccode, 'ALCOH', hpercode),
      historyTOBAC: await checkAdmissionHistory(encounter.enccode, 'TOBAC', hpercode),
      historyDRUGA: await checkAdmissionHistory(encounter.enccode, 'DRUGA', hpercode),
      historyOTHAL: await checkAdmissionHistory(encounter.enccode, 'OTHAL', hpercode),
      historyOB: await checkAdmissionHistoryOB(encounter.enccode, hpercode),
      prenatal: await checkAdmissionPrenatal(encounter.enccode, hpercode),
      pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(encounter.enccode, hpercode),
      physicalExam: await checkAdmissionPhysicalExam(encounter.enccode, hpercode),
      systemReview: await checkAdmissionSystemReview(encounter.enccode, hpercode),
      courseWard: await checkAdmissionCourseWard(encounter.enccode, hpercode),
    };
    const isComplete = Object.entries(results).filter(([k]) => k !== 'enccode').every(([, v]) => v === true);
    const missingFields = Object.entries(results).filter(([k, v]) => k !== 'enccode' && !v).map(([k]) => k);
    res.json({ ok: true, enccode: inputEnccode, isComplete, details: results, missingFields });
  } catch (error) {
    next(error);
  }
}

async function validateDischarge(req, res, next) {
  try {
    const { enccode: inputEnccode } = req.params;
    const encounter = await resolveEncounterRecord(inputEnccode);
    const dischargeOrder = await checkDischargeOrder(encounter.enccode);
    const finalDiagnosis = await checkFinalDiagnosis(encounter.enccode);
    const icdCode = await checkICDCode(encounter.enccode);
    const courseInWard = await checkCourseInTheWardDischarge(encounter.enccode);
    const results = { enccode: encounter.enccode, dischargeOrder: !!dischargeOrder, finalDiagnosis: !!finalDiagnosis, icdCode: !!icdCode, courseInWard };
    const isComplete = Object.entries(results).filter(([k]) => k !== 'enccode').every(([, v]) => v === true);
    const missingFields = Object.entries(results).filter(([k, v]) => k !== 'enccode' && !v).map(([k]) => k);
    res.json({ ok: true, enccode: inputEnccode, isComplete, details: { ...results, dischargeOrderDate: dischargeOrder || null, finalDiagnosisText: finalDiagnosis || null, icdCodeValue: icdCode || null }, missingFields });
  } catch (error) {
    next(error);
  }
}

async function getValidationDetails(req, res, next) {
  try {
    const { enccode: inputEnccode } = req.params;
    const encounter = await resolveEncounterRecord(inputEnccode);
    const hpercode = encounter.hpercode;
    const allValidations = {
      admission: {
        vitalSigns: await checkAdmissionVitalSigns(encounter.enccode, hpercode),
        bmi: await checkAdmissionBMI(encounter.enccode, hpercode),
        histories: {
          GDPPR: await checkAdmissionHistory(encounter.enccode, 'GDPPR', hpercode),
          COMPL: await checkAdmissionHistory(encounter.enccode, 'COMPL', hpercode),
          PRHIS: await checkAdmissionHistory(encounter.enccode, 'PRHIS', hpercode),
          PAHIS: await checkAdmissionHistory(encounter.enccode, 'PAHIS', hpercode),
          OCENV: await checkAdmissionHistory(encounter.enccode, 'OCENV', hpercode),
          FAHIS: await checkAdmissionHistory(encounter.enccode, 'FAHIS', hpercode),
          DRTHE: await checkAdmissionHistory(encounter.enccode, 'DRTHE', hpercode),
          ALCOH: await checkAdmissionHistory(encounter.enccode, 'ALCOH', hpercode),
          TOBAC: await checkAdmissionHistory(encounter.enccode, 'TOBAC', hpercode),
          DRUGA: await checkAdmissionHistory(encounter.enccode, 'DRUGA', hpercode),
          OTHAL: await checkAdmissionHistory(encounter.enccode, 'OTHAL', hpercode),
        },
        ob: await checkAdmissionHistoryOB(encounter.enccode, hpercode),
        prenatal: await checkAdmissionPrenatal(encounter.enccode, hpercode),
        pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(encounter.enccode, hpercode),
        physicalExam: await checkAdmissionPhysicalExam(encounter.enccode, hpercode),
        systemReview: await checkAdmissionSystemReview(encounter.enccode, hpercode),
        courseWard: await checkAdmissionCourseWard(encounter.enccode, hpercode),
      },
      discharge: {
        order: await checkDischargeOrder(encounter.enccode),
        finalDiagnosis: await checkFinalDiagnosis(encounter.enccode),
        icdCode: await checkICDCode(encounter.enccode),
        courseInWard: await checkCourseInTheWardDischarge(encounter.enccode),
      },
      phic: await checkPhicStatus(encounter.enccode),
    };
    res.json({ ok: true, enccode: inputEnccode, validation: allValidations });
  } catch (error) {
    next(error);
  }
}

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

module.exports = {
  listHospitalForms,
  listValidations,
  getFormValidations,
  createFormValidatorMapping,
  createFormValidation,
  deleteFormValidation,
  runFormValidations,
};
