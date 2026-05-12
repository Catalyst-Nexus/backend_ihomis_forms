/**
 * Lab Upload Controller
 *
 * Workflow: Patient → Encounter → Order → Procedure → Upload → Finalize
 *
 * Architecture:
 *   - MySQL    : Source of truth for hospital identifiers (hpercode, enccode, orcode, proccode)
 *
 * Key identifiers:
 *   - hpercode  : patient ID  (from MySQL patregistry)
 *   - enccode   : encounter ID (from MySQL henctr)
 *   - orcode    : order ID     (from MySQL hdocord)
 *   - proccode  : procedure ID (from MySQL pcchrgcod/hdocord)
 *   - docointkey: document tracking key — auto-generated on upload
 */

const pool = require("../config/db");

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
 * proccode is joined with hprocm to get procdesc (procedure description)
 */
async function getOrdersForEncounter(req, res, next) {
  try {
    // URL-decode the enccode parameter (comes URL-encoded from route)
    let enccode = req.params.enccode
      ? decodeURIComponent(req.params.enccode)
      : null;
    const orderType = req.query.type || "all";
    const status = req.query.status || "S";
    const hpercode = req.query.hpercode || null; // Optional: query by hpercode instead

    if (!enccode && !hpercode) {
      return res
        .status(400)
        .json({ ok: false, message: "enccode or hpercode is required" });
    }

    console.log(
      `[getOrdersForEncounter] enccode: "${enccode}", hpercode: "${hpercode}", type: ${orderType}, status: ${status}`,
    );

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
    // Note: procstat values in the database are 'U', null, etc.
    const applyStatusFilter =
      status && status !== "all" && status.trim() !== "";

    // Determine query approach: by enccode or by hpercode
    let queryByEncounter = false;
    let queryByPatient = false;
    let resolvedEnccode = enccode; // Use the full enccode for hdocord

    if (enccode) {
      // First try by enccode directly
      const [checkByEnc] = await pool.query(
        `SELECT COUNT(*) as total FROM hdocord WHERE enccode = ?`,
        [enccode],
      );
      console.log(
        `[getOrdersForEncounter] hdocord records for enccode "${enccode}": ${checkByEnc[0]?.total}`,
      );

      if (checkByEnc[0]?.total > 0) {
        queryByEncounter = true;
      } else {
        // Try to find the full enccode from hdocord that starts with the provided enccode
        // hdocord.enccode format: {short_enccode}{date}{time}
        // Example: 000502700000000000296104/18/202510:07:32
        const [fullEncMatch] = await pool.query(
          `SELECT enccode FROM hdocord WHERE enccode LIKE ? LIMIT 1`,
          [`${enccode}%`],
        );
        if (fullEncMatch[0]?.enccode) {
          console.log(
            `[getOrdersForEncounter] Found full enccode: "${fullEncMatch[0].enccode}" for short: "${enccode}"`,
          );
          resolvedEnccode = fullEncMatch[0].enccode;
          queryByEncounter = true;
        }
      }
    }

    // If no records by enccode, try by hpercode
    if (!queryByEncounter && hpercode) {
      // Get hpercode from henctr if not provided
      let resolvedHpercode = hpercode;
      if (enccode) {
        const [encRows] = await pool.query(
          `SELECT hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode],
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
          [resolvedHpercode],
        );
        console.log(
          `[getOrdersForEncounter] hdocord records for hpercode "${resolvedHpercode}": ${checkByPat[0]?.total}`,
        );

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
        DATE_FORMAT(hdocord.dodate, '%Y-%m-%d') AS dodate,
        DATE_FORMAT(hdocord.dodate, '%Y-%m-%d') AS ordate,
        DATE_FORMAT(hdocord.dotime, '%H:%i:%s') AS ortime,
        hprocm.procstat,
        henctr.hpercode,
        hperson.patlast,
        hperson.patfirst,
        hperson.patmiddle,
        hprocm.procdesc
    `;

    if (queryByEncounter) {
      // Query by enccode - use resolvedEnccode (full enccode from hdocord)
      let params = [resolvedEnccode];
      let query = `
        ${baseSelect}
         FROM hdocord
         INNER JOIN henctr ON henctr.enccode = hdocord.enccode
         INNER JOIN hperson ON hperson.hpercode = henctr.hpercode
         LEFT JOIN hprocm ON hprocm.proccode = hdocord.proccode
         WHERE hdocord.enccode = ?
         ${typeCondition}
      `;

      if (applyStatusFilter) {
        query += " AND hdocord.estatus = ?";
        params.push(status);
      }

      query += ` ORDER BY hdocord.dodate DESC, hdocord.dotime DESC, hdocord.docointkey DESC LIMIT 100`;

      [rows] = await pool.query(query, params);
    } else if (queryByPatient) {
      // Query by hpercode - get all encounters for this patient
      let resolvedHpercode = hpercode;
      if (enccode) {
        const [encRows] = await pool.query(
          `SELECT hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode],
        );
        if (encRows[0]?.hpercode) {
          resolvedHpercode = encRows[0].hpercode;
        }
      }

      if (resolvedHpercode) {
        const params = [resolvedHpercode];
        const statusCondition = applyStatusFilter
          ? "AND hdocord.estatus = ?"
          : "";
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
          params,
        );
      }
    } else {
      // No records found - return empty with debug info
      console.log(
        `[getOrdersForEncounter] No hdocord records found for enccode: "${enccode}"`,
      );

      // Check if encounter exists at all
      if (enccode) {
        const [encExists] = await pool.query(
          `SELECT enccode, hpercode FROM henctr WHERE enccode = ? LIMIT 1`,
          [enccode],
        );
        if (encExists[0]) {
          console.log(
            `[getOrdersForEncounter] Encounter exists in henctr with hpercode: "${encExists[0].hpercode}"`,
          );

          // Check if this hpercode has ANY hdocord records
          const [patOrders] = await pool.query(
            `SELECT COUNT(*) as total FROM hdocord 
             INNER JOIN henctr ON henctr.enccode = hdocord.enccode
             WHERE henctr.hpercode = ?`,
            [encExists[0].hpercode],
          );
          console.log(
            `[getOrdersForEncounter] Patient has ${patOrders[0]?.total} total hdocord records`,
          );
        }
      }
    }

    console.log(`[getOrdersForEncounter] Found ${rows.length} orders`);

    return res.json({
      ok: true,
      // Return both short and full enccode for consistency
      enccode: enccode || null, // Original short enccode from request
      enccodeFull: resolvedEnccode || enccode || null, // Full hdocord enccode
      hpercode: hpercode || null,
      orderType,
      count: rows.length,
      data: rows,
      _debug: {
        queryByEncounter,
        queryByPatient,
        enccodeLength: enccode ? enccode.length : 0,
        hpercodeLength: hpercode ? hpercode.length : 0,
        resolvedEnccode: resolvedEnccode,
      },
    });
  } catch (error) {
    console.error(`[getOrdersForEncounter] Error:`, error);
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
       ORDER BY TABLE_NAME`,
    );

    const schemas = {};
    for (const { TABLE_NAME } of tables) {
      const [columns] = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [TABLE_NAME],
      );
      schemas[TABLE_NAME] = columns;
    }

    res.json({
      ok: true,
      tables: tables.map((t) => t.TABLE_NAME),
      schemas,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/db/debug/sample-data
 * Debug endpoint to check actual orcode/proccode values in the database
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
       LIMIT 20`,
    );

    // Get sample hdocord rows with orcode
    const [sampleHdocord] = await pool.query(
      `SELECT enccode, docointkey, orcode, dodate,
       FROM hdocord 
       WHERE orcode IS NOT NULL AND orcode != '' 
       LIMIT 10`,
    );

    // List all tables to find one with proccode
    const [allTables] = await pool.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       ORDER BY TABLE_NAME`,
    );

    // Search for proccode in all tables
    const tablesWithProccode = [];
    for (const { TABLE_NAME } of allTables) {
      const [columns] = await pool.query(
        `SELECT COLUMN_NAME 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME LIKE '%proc%'`,
        [TABLE_NAME],
      );
      if (columns.length > 0) {
        tablesWithProccode.push({
          table: TABLE_NAME,
          columns: columns.map((c) => c.COLUMN_NAME),
        });
      }
    }

    // Also check for 'lib' tables (common for lab items)
    const [libTables] = await pool.query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND (TABLE_NAME LIKE '%lib%' OR TABLE_NAME LIKE '%cat%' OR TABLE_NAME LIKE '%hdl%')
       ORDER BY TABLE_NAME`,
    );

    // Get proccode values from hdocord
    const [proccodeInHdocord] = await pool.query(
      `SELECT DISTINCT proccode, COUNT(*) as count 
       FROM hdocord 
       WHERE proccode IS NOT NULL AND proccode != '' 
       GROUP BY proccode 
       ORDER BY count DESC 
       LIMIT 20`,
    );

    // Get procedure master list with descriptions
    const [procedureMaster] = await pool.query(
      `SELECT proccode, procdesc, procstat 
       FROM hprocm 
       WHERE proccode IS NOT NULL AND proccode != '' 
       ORDER BY procdesc 
       LIMIT 30`,
    );

    // Get lab result library
    const [labResultLib] = await pool.query(
      `SELECT * FROM labresultlibrary LIMIT 20`,
    );

    res.json({
      ok: true,
      orcodeSummary: orcodeRows,
      sampleHdocord: sampleHdocord,
      tablesWithProcColumns: tablesWithProccode,
      libLikeTables: libTables.map((t) => t.TABLE_NAME),
      proccodeInHdocord: proccodeInHdocord,
      procedureMaster: procedureMaster,
      labResultLibrary: labResultLib,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getOrdersForEncounter,
  debugSchema,
  debugSampleData,
};
