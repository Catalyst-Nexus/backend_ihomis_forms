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
    if (!hpercode) return false;
    const [rows] = await pool.query(`SELECT 1 FROM ${table} WHERE hpercode = ?${where} LIMIT 1`, [hpercode, ...params]);
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking ${table} by hpercode:`, error);
    return false;
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
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data, error } = await supabase.from('hospital_forms').select('id, description, component_name, is_active').order('id', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, forms: data || [] });
  } catch (error) {
    next(error);
  }
}

async function listValidations(req, res, next) {
  try {
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data, error } = await supabase.from('validation').select('id, description, query, created_at').order('id', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, validations: data || [] });
  } catch (error) {
    next(error);
  }
}

async function getFormValidations(req, res, next) {
  try {
    const { formId } = req.params;
    if (!formId) return res.status(400).json({ ok: false, error: 'formId required' });
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data: mappings, error: mapErr } = await supabase.from('formvalidator').select('*').eq('formid', formId);
    if (mapErr) throw mapErr;
    const validationIds = mappings.map(m => m.validationid).filter(Boolean);
    let validations = [];
    if (validationIds.length > 0) {
      const { data, error } = await supabase.from('validation').select('*').in('id', validationIds);
      if (error) throw error;
      validations = data;
    }
    const validationsWithMapping = validations.map(v => {
      const map = mappings.find(m => m.validationid === v.id);
      return { ...v, mappingId: map ? map.id : null };
    });
    res.json({ ok: true, formId, validations: validationsWithMapping });
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
    const encounter = await resolveEncounterRecord(inputEnccode);
    const enccode = encounter.enccode;
    const hpercode = encounter.hpercode;
    if (!supabase || typeof supabase.from !== 'function') return res.status(500).json({ ok: false, error: 'Supabase client not configured on server' });
    const { data: mappings, error: mapErr } = await supabase.from('formvalidator').select('*').eq('formid', formId);
    if (mapErr) throw mapErr;
    const validationIds = mappings.map(m => m.validationid).filter(Boolean);
    let validations = [];
    if (validationIds.length > 0) {
      const { data, error } = await supabase.from('validation').select('*').in('id', validationIds);
      if (error) throw error;
      validations = data;
    }
    const results = [];
    for (const v of validations) {
      const mapping = mappings.find(m => m.validationid === v.id) || {};
      const prepared = prepareQuery(v.query, { enccode, hpercode });
      let success = false;
      let info = null;
      try {
        const [rows] = await pool.query(prepared);
        info = Array.isArray(rows) ? { rowCount: rows.length, sample: rows.slice(0, 10) } : { result: rows };
        success = Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
      } catch (e) {
        info = { error: e.message };
        success = false;
      }
      results.push({ validationId: v.id, mappingId: mapping.id || null, description: v.description, query: v.query, preparedQuery: prepared, success, info });
    }
    res.json({ ok: true, formId, enccode, results });
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
