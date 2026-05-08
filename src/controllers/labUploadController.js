/**
 * Lab Upload Controller
 *
 * Workflow: Patient → Encounter → Order → Procedure → Upload → Finalize
 *
 * Architecture:
 *   - MySQL    : Source of truth for hospital identifiers (hpercode, enccode, orcode, procode)
 *   - Supabase: PDF file storage (Storage API) + upload metadata (lab_result_uploads table)
 *
 * Key identifiers:
 *   - hpercode  : patient ID  (from MySQL patregistry)
 *   - enccode   : encounter ID (from MySQL henctr)
 *   - orcode    : order ID     (from MySQL hdocord)
 *   - procode   : procedure ID (from MySQL pcchrgcod)
 *   - docointkey: document tracking key — auto-generated on upload
 */

const pool = require("../config/db");
const { createClient } = require("@supabase/supabase-js");

// ── Supabase admin client (lazy init) ──────────────────────────
let _supabaseAdmin = null;

function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  _supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _supabaseAdmin;
}

/**
 * Generate a unique docointkey.
 * Format: LR{YYYYMMDD}{seq}  e.g. LR2026050600001
 * Queries the existing lab_result_uploads table in Supabase for the next seq.
 */
async function generateDocointkey(supabase) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `LR${today}`;

  const { data, error } = await supabase
    .from("lab_result_uploads")
    .select("docointkey")
    .like("docointkey", `${prefix}%`)
    .order("docointkey", { ascending: false })
    .limit(1);

  let nextSeq = 1;
  if (!error && data && data.length > 0) {
    const lastKey = data[0].docointkey || "";
    const lastSeq = parseInt(lastKey.replace(prefix, ""), 10);
    nextSeq = isNaN(lastSeq) ? 1 : lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

// ── MySQL validation helpers ────────────────────────────────────

async function validatePatientInMySQL(hpercode) {
  const [rows] = await pool.query(
    "SELECT hpercode, patlast, patfirst, patmiddle FROM hperson WHERE hpercode = ? LIMIT 1",
    [hpercode],
  );
  return rows[0] || null;
}

async function validateEncounterInMySQL(enccode, hpercode) {
  const [rows] = await pool.query(
    "SELECT enccode, hpercode, fhud, toecode FROM henctr WHERE enccode = ? AND hpercode = ? LIMIT 1",
    [enccode, hpercode],
  );
  return rows[0] || null;
}

async function validateOrderInMySQL(docointkey, enccode) {
  const [rows] = await pool.query(
    "SELECT enccode, docointkey, entryby FROM hdocord WHERE docointkey = ? AND enccode = ? LIMIT 1",
    [docointkey, enccode],
  );
  return rows[0] || null;
}

// ── Route handlers ─────────────────────────────────────────────

/**
 * GET /api/db/encounters/:enccode/orders
 * Fetch lab/radiology orders for a specific encounter from MySQL.
 *
 * Query params:
 *   - type: 'lab' | 'rad' | 'all' (default: 'all')
 *   - status: order estatus filter (default: 'S')
 * 
 * orcode values in hdocord:
 *   - LABOR = Laboratory orders
 *   - RADIO = Radiology orders
 *   - DISCH = Discharge orders
 *   - DIETT = Diet orders
 * 
 * proccode format: LABOR####, RADIO####, XRAY####, etc.
 * proccode is joined with hprocm to get procdesc (description)
 */
async function getOrdersForEncounter(req, res, next) {
  try {
    const { enccode } = req.params;
    const orderType = req.query.type || "all";
    const status = req.query.status || "S";
    const hpercode = req.query.hpercode || null; // Optional: query by hpercode instead

    if (!enccode && !hpercode) {
      return res
        .status(400)
        .json({ ok: false, message: "enccode or hpercode is required" });
    }

    console.log(`[getOrdersForEncounter] enccode: "${enccode}", hpercode: "${hpercode}", type: ${orderType}, status: ${status}`);

    // Build type filter based on orcode column
    // LABOR = Lab, RADIO = Radiology
    // Note: orcode values are exactly 'LABOR', 'RADIO', 'DISCH', 'DIETT'
    let typeCondition = "";
    if (orderType === "lab") {
      typeCondition = "AND hdocord.orcode = 'LABOR'";
    } else if (orderType === "rad") {
      typeCondition = "AND hdocord.orcode = 'RADIO'";
    }
    // 'all' returns all orders without type filter

    // Handle status filter - support both "all" and specific statuses
    // Note: estatus values in the database are 'U', null, etc.
    const applyStatusFilter = status && status !== "all" && status.trim() !== "";
    
    // Determine query approach: by enccode or by hpercode
    let queryByEncounter = false;
    let queryByPatient = false;
    
    if (enccode) {
      // First try by enccode
      const [checkByEnc] = await pool.query(
        `SELECT COUNT(*) as total FROM hdocord WHERE enccode = ?`,
        [enccode]
      );
      console.log(`[getOrdersForEncounter] hdocord records for enccode "${enccode}": ${checkByEnc[0]?.total}`);
      
      if (checkByEnc[0]?.total > 0) {
        queryByEncounter = true;
      }
    }
    
    // If no records by enccode, try by hpercode
    if (!queryByEncounter && hpercode) {
      // Get hpercode from henctr if not provided
      let resolvedHpercode = hpercode;
      if (enccode) {
        const [encRows] = await pool.query(
          `SELECT hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode]
        );
        if (encRows[0]?.hpercode) {
          resolvedHpercode = encRows[0].hpercode;
        }
      }
      
      if (resolvedHpercode) {
        const [checkByPat] = await pool.query(
          `SELECT COUNT(*) as total FROM hdocord 
           INNER JOIN henctr ON henctr.enccode = hdocord.enccode
           WHERE henctr.hpercode = ?`,
          [resolvedHpercode]
        );
        console.log(`[getOrdersForEncounter] hdocord records for hpercode "${resolvedHpercode}": ${checkByPat[0]?.total}`);
        
        if (checkByPat[0]?.total > 0) {
          queryByPatient = true;
        }
      }
    }
    
    let rows = [];
    const baseSelect = `
      SELECT
        hdocord.enccode,
        hdocord.docointkey,
        hdocord.orcode,
        hdocord.proccode,
        hdocord.entryby,
        DATE_FORMAT(hdocord.dodate, '%Y-%m-%d') AS ordate,
        DATE_FORMAT(hdocord.dotime, '%H:%i:%s') AS ortime,
        hdocord.estatus,
        henctr.hpercode,
        hperson.patlast,
        hperson.patfirst,
        hperson.patmiddle,
        hprocm.procdesc AS procedureDescription
    `;
    
    if (queryByEncounter) {
      // Query by enccode
      const params = [enccode];
      const statusCondition = applyStatusFilter ? "AND hdocord.estatus = ?" : "";
      if (applyStatusFilter) {
        params.push(status);
      }
      
      [rows] = await pool.query(
        `${baseSelect}
         FROM hdocord
         INNER JOIN henctr ON henctr.enccode = hdocord.enccode
         INNER JOIN hperson ON hperson.hpercode = henctr.hpercode
         LEFT JOIN hprocm ON hprocm.proccode = hdocord.proccode
         WHERE hdocord.enccode = ?
         ${typeCondition}
         ${statusCondition}
         ORDER BY hdocord.dodate DESC, hdocord.dotime DESC, hdocord.docointkey DESC
         LIMIT 100`,
        params
      );
    } else if (queryByPatient) {
      // Query by hpercode - get all encounters for this patient
      let resolvedHpercode = hpercode;
      if (enccode) {
        const [encRows] = await pool.query(
          `SELECT hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode]
        );
        if (encRows[0]?.hpercode) {
          resolvedHpercode = encRows[0].hpercode;
        }
      }
      
      if (resolvedHpercode) {
        const params = [resolvedHpercode];
        const statusCondition = applyStatusFilter ? "AND hdocord.estatus = ?" : "";
        if (applyStatusFilter) {
          params.push(status);
        }
        
        [rows] = await pool.query(
          `${baseSelect}
           FROM hdocord
           INNER JOIN henctr ON henctr.enccode = hdocord.enccode
           INNER JOIN hperson ON hperson.hpercode = henctr.hpercode
           LEFT JOIN hprocm ON hprocm.proccode = hdocord.proccode
           WHERE henctr.hpercode = ?
           ${typeCondition}
           ${statusCondition}
           ORDER BY hdocord.dodate DESC, hdocord.dotime DESC, hdocord.docointkey DESC
           LIMIT 100`,
          params
        );
      }
    } else {
      // No records found - return empty with debug info
      console.log(`[getOrdersForEncounter] No hdocord records found for enccode: "${enccode}"`);
      
      // Check if encounter exists at all
      if (enccode) {
        const [encExists] = await pool.query(
          `SELECT enccode, hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode]
        );
        if (encExists[0]) {
          console.log(`[getOrdersForEncounter] Encounter exists in henctr with hpercode: "${encExists[0].hpercode}"`);
          
          // Check if this hpercode has ANY hdocord records
          const [patOrders] = await pool.query(
            `SELECT COUNT(*) as total FROM hdocord 
             INNER JOIN henctr ON henctr.enccode = hdocord.enccode
             WHERE henctr.hpercode = ?`,
            [encExists[0].hpercode]
          );
          console.log(`[getOrdersForEncounter] Patient has ${patOrders[0]?.total} total hdocord records`);
        }
      }
    }

    console.log(`[getOrdersForEncounter] Found ${rows.length} orders`);

    return res.json({
      ok: true,
      enccode: enccode || null,
      hpercode: hpercode || null,
      orderType,
      count: rows.length,
      data: rows,
      _debug: {
        queryByEncounter,
        queryByPatient,
        enccodeLength: enccode ? enccode.length : 0,
        hpercodeLength: hpercode ? hpercode.length : 0,
      }
    });
  } catch (error) {
    console.error(`[getOrdersForEncounter] Error:`, error);
    return next(error);
  }
}

/**
 * GET /api/db/encounters/:enccode/orders/:docointkey/procedures
 * Fetch procedures (line items) for a specific order from MySQL.
 * Returns empty array if pcchrgcod table doesn't exist or has different schema.
 * 
 * Note: pcchrgcod.orcode references hdocord.docointkey
 */
async function getProceduresForOrder(req, res, next) {
  try {
    const { enccode, docointkey } = req.params;

    if (!enccode || !docointkey) {
      return res.status(400).json({
        ok: false,
        message: "enccode and docointkey are required",
      });
    }

    // Try pcchrgcod first, but don't fail if it doesn't exist
    let rows = [];
    try {
      const [procRows] = await pool.query(
        `SELECT * FROM pcchrgcod WHERE enccode = ? AND orcode = ? LIMIT 50`,
        [enccode, docointkey],
      );
      rows = procRows;
    } catch (pcError) {
      // pcchrgcod table might not exist or has different schema
      console.warn("pcchrgcod query failed:", pcError.message);
    }

    return res.json({
      ok: true,
      enccode,
      docointkey,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/db/lab-results
 *
 * Finalize a lab upload:
 *   1. Validate patient + encounter exist in MySQL (source of truth)
 *   2. Upload PDF to Supabase Storage
 *   3. Insert upload metadata into Supabase lab_result_uploads table
 *   4. Return docointkey for tracking
 *
 * Multipart/form-data fields:
 *   - file                  : PDF file (required)
 *   - hpercode              : patient ID (required)
 *   - enccode               : encounter ID (required)
 *   - orcode                : order ID (optional)
 *   - procode               : procedure ID from pcchrgcod (optional)
 *   - procedureInstanceId   : alias for procode (optional)
 *   - docointkey            : tracking key — auto-generated if not provided
 *   - remarks               : upload remarks (optional)
 *   - uploadedBy            : user who uploaded (optional)
 */
async function registerLabResultUpload(req, res, next) {
  try {
    const {
      hpercode,
      enccode,
      orcode = null,
      procode = null,
      procedureInstanceId = null,
      docointkey: providedDocointkey = null,
      remarks = "",
      uploadedBy = null,
    } = req.body;

    const file = req.file; // multer puts parsed fields here

    // ── 1. Validate required fields ──────────────────────────────
    if (!hpercode) {
      return res
        .status(400)
        .json({ ok: false, message: "hpercode is required" });
    }
    if (!enccode) {
      return res
        .status(400)
        .json({ ok: false, message: "enccode is required" });
    }
    if (!file) {
      return res
        .status(400)
        .json({ ok: false, message: "PDF file is required" });
    }

    // ── 2. Validate patient in MySQL ─────────────────────────────
    const patient = await validatePatientInMySQL(hpercode);
    if (!patient) {
      return res.status(404).json({ ok: false, message: "Patient not found" });
    }

    // ── 3. Validate encounter in MySQL ──────────────────────────
    const encounter = await validateEncounterInMySQL(enccode, hpercode);
    if (!encounter) {
      return res
        .status(404)
        .json({ ok: false, message: "Encounter not found" });
    }

    // ── 4. Validate order in MySQL if provided ───────────────────
    if (orcode) {
      const order = await validateOrderInMySQL(orcode, enccode);
      if (!order) {
        return res.status(404).json({ ok: false, message: "Order not found" });
      }
    }

    // ── 5. Resolve procode ───────────────────────────────────────
    // procode takes precedence; procedureInstanceId is an alias
    const resolvedProcode = procode || procedureInstanceId || null;

    // ── 6. Get Supabase client and generate docointkey ──────────
    const supabase = getSupabaseAdmin();
    const docointkey =
      providedDocointkey || (await generateDocointkey(supabase));

    // ── 7. Upload PDF to Supabase Storage ───────────────────────
    const bucketName = process.env.SUPABASE_LAB_BUCKET || "lab-results";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = String(file.originalname || "lab_result.pdf")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storagePath = `lab-results/${enccode}/${timestamp}-${safeName}`;

    let uploadedUrl;
    try {
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype || "application/pdf",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(
          uploadError.message || "Supabase Storage upload failed",
        );
      }

      // Build URL — prefer signed URL if configured
      const useSigned =
        String(process.env.SUPABASE_USE_SIGNED_URL || "true").toLowerCase() ===
        "true";
      const signedTtl = Number(process.env.SUPABASE_SIGNED_URL_TTL || 3600);

      if (useSigned) {
        const { data: signedData, error: signedError } = await supabase.storage
          .from(bucketName)
          .createSignedUrl(storagePath, signedTtl);

        if (!signedError && signedData?.signedUrl) {
          uploadedUrl = signedData.signedUrl;
        }
      }

      if (!uploadedUrl) {
        const { data: publicData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(storagePath);
        uploadedUrl =
          publicData?.publicUrl ||
          `https://${bucketName}.supabase.co/storage/v1/object/public/${storagePath}`;
      }
    } catch (supabaseError) {
      return res.status(502).json({
        ok: false,
        message: `Supabase upload failed: ${supabaseError.message}`,
      });
    }

    // ── 8. Insert metadata into Supabase lab_result_uploads ─────
    // Column names match the existing Supabase schema exactly:
    // hpercode, enccode, orcode, procode, procedure_instance_id, docointkey, ...
    const { data: insertData, error: insertError } = await supabase
      .from("lab_result_uploads")
      .insert({
        hpercode,
        enccode,
        orcode: orcode || null,
        procode: resolvedProcode || null,
        procedure_instance_id: resolvedProcode || null,
        docointkey,
        file_name: file.originalname || "lab_result.pdf",
        file_url: uploadedUrl,
        storage_path: storagePath,
        file_size: file.size,
        content_type: file.mimetype || "application/pdf",
        uploaded_by: uploadedBy || null,
        remarks: remarks || null,
        source: "lab-upload",
        is_signed_url: useSigned,
        url_expires_at: useSigned
          ? new Date(Date.now() + signedTtl * 1000).toISOString()
          : null,
      })
      .select()
      .single();

    if (insertError) {
      // Rollback: remove uploaded file if metadata insert failed
      await supabase.storage.from(bucketName).remove([storagePath]);
      return res.status(502).json({
        ok: false,
        message: `Failed to save upload record: ${insertError.message}`,
      });
    }

    return res.status(201).json({
      ok: true,
      docointkey,
      uploadedPdfUrl: uploadedUrl,
      fileName: file.originalname,
      fileSize: file.size,
      patientId: hpercode,
      encounterCode: enccode,
      orderCode: orcode,
      procode: resolvedProcode,
      procedureInstanceId: resolvedProcode,
      message: "Lab result uploaded successfully",
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/db/debug/schema
 * Debug endpoint to check actual table schemas
 */
async function debugSchema(req, res, next) {
  try {
    const [tables] = await pool.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME IN ('hdocord', 'henctr', 'hperson', 'pcchrgcod', 'hpercode', 'hadmlog')
       ORDER BY TABLE_NAME`
    );

    const schemas = {};
    for (const { TABLE_NAME } of tables) {
      const [columns] = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [TABLE_NAME]
      );
      schemas[TABLE_NAME] = columns;
    }

    res.json({
      ok: true,
      tables: tables.map(t => t.TABLE_NAME),
      schemas
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/db/debug/sample-data
 * Debug endpoint to check actual orcode/procode values in the database
 */
async function debugSampleData(req, res, next) {
  try {
    // Check orcode values in hdocord
    const [orcodeRows] = await pool.query(
      `SELECT DISTINCT orcode, COUNT(*) as count 
       FROM hdocord 
       WHERE orcode IS NOT NULL AND orcode != '' 
       GROUP BY orcode 
       ORDER BY count DESC 
       LIMIT 20`
    );

    // Get sample hdocord rows with orcode
    const [sampleHdocord] = await pool.query(
      `SELECT enccode, docointkey, orcode, dodate, estatus 
       FROM hdocord 
       WHERE orcode IS NOT NULL AND orcode != '' 
       LIMIT 10`
    );

    // List all tables to find one with procode
    const [allTables] = await pool.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       ORDER BY TABLE_NAME`
    );

    // Search for procode in all tables
    const tablesWithProcode = [];
    for (const { TABLE_NAME } of allTables) {
      const [columns] = await pool.query(
        `SELECT COLUMN_NAME 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME LIKE '%proc%'`,
        [TABLE_NAME]
      );
      if (columns.length > 0) {
        tablesWithProcode.push({
          table: TABLE_NAME,
          columns: columns.map(c => c.COLUMN_NAME)
        });
      }
    }

    // Also check for 'lib' tables (common for lab items)
    const [libTables] = await pool.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND (TABLE_NAME LIKE '%lib%' OR TABLE_NAME LIKE '%cat%' OR TABLE_NAME LIKE '%hdl%')
       ORDER BY TABLE_NAME`
    );

    // Get proccode values from hdocord
    const [proccodeInHdocord] = await pool.query(
      `SELECT DISTINCT proccode, COUNT(*) as count 
       FROM hdocord 
       WHERE proccode IS NOT NULL AND proccode != '' 
       GROUP BY proccode 
       ORDER BY count DESC 
       LIMIT 20`
    );

    // Get procedure master list with descriptions
    const [procedureMaster] = await pool.query(
      `SELECT proccode, procdesc, procstat 
       FROM hprocm 
       WHERE proccode IS NOT NULL AND proccode != '' 
       ORDER BY procdesc 
       LIMIT 30`
    );

    // Get lab result library
    const [labResultLib] = await pool.query(
      `SELECT * FROM labresultlibrary LIMIT 20`
    );

    res.json({
      ok: true,
      orcodeSummary: orcodeRows,
      sampleHdocord: sampleHdocord,
      tablesWithProcColumns: tablesWithProcode,
      libLikeTables: libTables.map(t => t.TABLE_NAME),
      proccodeInHdocord: proccodeInHdocord,
      procedureMaster: procedureMaster,
      labResultLibrary: labResultLib,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/db/patients/:hpercode/uploaded-files
 * 
 * Fetch all uploaded lab result files for a patient from Supabase.
 * Used to show previously uploaded PDFs in the Review step.
 */
async function getPatientUploadedFiles(req, res, next) {
  try {
    const { hpercode } = req.params;
    const { enccode } = req.query;

    if (!hpercode) {
      return res.status(400).json({ 
        ok: false, 
        message: "hpercode is required" 
      });
    }

    const supabase = getSupabaseAdmin();
    
    // Build query for lab_result_uploads
    let query = supabase
      .from("lab_result_uploads")
      .select("*")
      .eq("hpercode", hpercode)
      .order("uploaded_at", { ascending: false })
      .limit(100);

    // Filter by encounter if provided
    if (enccode) {
      query = query.eq("enccode", enccode);
    }

    const { data: files, error } = await query;

    if (error) {
      console.error("Error fetching uploaded files:", error);
      return res.status(500).json({ 
        ok: false, 
        message: `Failed to fetch uploaded files: ${error.message}` 
      });
    }

    return res.json({
      ok: true,
      hpercode,
      enccode: enccode || null,
      count: files?.length || 0,
      data: files || [],
    });
  } catch (error) {
    console.error("getPatientUploadedFiles error:", error);
    return next(error);
  }
}

module.exports = {
  getOrdersForEncounter,
  getProceduresForOrder,
  registerLabResultUpload,
  debugSchema,
  debugSampleData,
  getPatientUploadedFiles,
};
