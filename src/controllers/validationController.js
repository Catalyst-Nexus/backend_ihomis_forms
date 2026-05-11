const pool = require('../config/db');
const supabase = require('../config/supabase');
const mysql = require('mysql2');

// Minimal Supabase-backed validation controller.
// Keeps only the admin CRUD endpoints and a runner that executes
// stored queries (from Supabase) against the MySQL database.

try {
  console.log('validationController loaded. supabase present:', !!supabase, 'hasFrom:', supabase && typeof supabase.from === 'function');
} catch (e) {
  console.warn('validationController: error checking supabase:', e && e.message);
}

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

  // If the placeholder is already wrapped in quotes in the stored template
  // replace the whole quoted expression with the escaped value to avoid
  // producing double-quoted strings (''value'').
  q = q.replace(/(["'])\s*(\{\{\s*enccode\s*\}\}|\$ENCCODE\$)\s*\1/gi, () => mysql.escape(replacements.enccode));
  q = q.replace(/(["'])\s*(\{\{\s*hpercode\s*\}\}|\$HPERCODE\$)\s*\1/gi, () => mysql.escape(replacements.hpercode));

  // Replace any remaining unquoted placeholders (mysql.escape will add quotes)
  q = q.replace(/\$ENCCODE\$|{{\s*enccode\s*}}|\{\{enccode\}\}/gi, () => mysql.escape(replacements.enccode));
  q = q.replace(/\$HPERCODE\$|{{\s*hpercode\s*}}|\{\{hpercode\}\}/gi, () => mysql.escape(replacements.hpercode));

  return q;
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
