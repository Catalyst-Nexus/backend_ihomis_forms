const express = require("express");
const pool = require("../config/db");
const {
  getValidationData,
  executeValidationQuery,
} = require("../controllers/validationController");

const router = express.Router();

// ===================== SINGLE VALIDATION DATA ENDPOINT =====================
// POST /api/validation/data - Get encounter data for validation
// Body: { enccode }
// Response: { ok, data: { enccode, hpercode, toecode, matchedBy, phicclaim, henctr, admissionLog, dischargeLog } }
// Frontend will fetch validation rules from Supabase and execute queries directly
router.post('/data', getValidationData);

// POST /api/validation/execute - Execute a validation query
// Body: { query, validationId?, description? }
// Response: { ok, success, info, validationId, description }
router.post('/execute', executeValidationQuery);

// ===================== DEBUG ENDPOINT =====================
// GET /api/validation/debug/:table/:enccode - Check if data exists in a table
// Useful for debugging why validations show missing
router.get('/debug/:table/:enccode', async (req, res, next) => {
  try {
    const { table, enccode } = req.params;
    
    // Whitelist allowed tables for safety
    const allowedTables = [
      'hvitalsign', 'hmrhisto', 'hencdiag', 'henctr', 'hadmlog', 'herlog', 'hopdlog',
      'hvsothr', 'hmrhistoob', 'hsignsymptoms', 'hphyexam', 'hmrsrev', 'hcrsward'
    ];
    
    if (!allowedTables.includes(table.toLowerCase())) {
      return res.status(400).json({ ok: false, error: 'Invalid table name' });
    }
    
    if (!enccode) {
      return res.status(400).json({ ok: false, error: 'enccode required' });
    }
    
    // Normalize enccode: extract base part before "/"
    const normalizedEnccode = String(enccode).split('/')[0].trim();
    
    // Try with original enccode
    const queryOriginal = `SELECT * FROM ${table} WHERE enccode = ? LIMIT 10`;
    const [rowsOriginal] = await pool.query(queryOriginal, [enccode]);
    
    // Try with normalized enccode
    const [rowsNormalized] = await pool.query(queryOriginal, [normalizedEnccode]);
    
    // Show sample of all records in table (to see what enccodes exist)
    const querySample = `SELECT DISTINCT enccode FROM ${table} LIMIT 5`;
    const [sampleEnccodes] = await pool.query(querySample);
    
    res.json({
      ok: true,
      table,
      originalEnccode: enccode,
      normalizedEnccode: normalizedEnccode,
      resultsWithOriginal: {
        rowCount: rowsOriginal.length,
        sample: rowsOriginal.slice(0, 2)
      },
      resultsWithNormalized: {
        rowCount: rowsNormalized.length,
        sample: rowsNormalized.slice(0, 2)
      },
      sampleEnccodes: sampleEnccodes,
      message: rowsNormalized.length > 0 ? 'FOUND with normalized enccode' : 'NOT FOUND'
    });
  } catch (error) {
    console.error('Debug query error:', error);
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

module.exports = router;
