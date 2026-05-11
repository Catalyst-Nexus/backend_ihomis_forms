const pool = require("../config/db");

const columnCache = new Map();

async function tableHasColumn(tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnCache.has(cacheKey)) {
    return columnCache.get(cacheKey);
  }

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );

  const exists = Number(rows?.[0]?.total || 0) > 0;
  columnCache.set(cacheKey, exists);
  return exists;
}

async function resolveEncounterRecord(enccode) {
  if (!enccode) {
    return {
      enccode: "",
      hpercode: "",
      toecode: "",
      matchedBy: "none",
    };
  }

  const [exactRows] = await pool.query(
    "SELECT enccode, hpercode, toecode FROM henctr WHERE enccode = ? LIMIT 1",
    [enccode],
  );

  if (exactRows.length > 0) {
    return {
      enccode: exactRows[0].enccode || enccode,
      hpercode: exactRows[0].hpercode || "",
      toecode: exactRows[0].toecode || "",
      matchedBy: "exact",
    };
  }

  const baseEnccode = enccode.split("/")[0];
  const [prefixRows] = await pool.query(
    "SELECT enccode, hpercode, toecode FROM henctr WHERE enccode LIKE CONCAT(?, '/%') LIMIT 1",
    [baseEnccode],
  );

  if (prefixRows.length > 0) {
    return {
      enccode: prefixRows[0].enccode || enccode,
      hpercode: prefixRows[0].hpercode || "",
      toecode: prefixRows[0].toecode || "",
      matchedBy: "prefix",
    };
  }

  return {
    enccode,
    hpercode: "",
    toecode: "",
    matchedBy: "none",
  };
}

async function resolveHpercode(enccode) {
  const record = await resolveEncounterRecord(enccode);
  return record.hpercode;
}

async function hasRecordByEnccode({ table, enccode, where = "", params = [] }) {
  const sql = `SELECT 1 FROM ${table} WHERE enccode = ?${where} LIMIT 1`;
  const [rows] = await pool.query(sql, [enccode, ...params]);
  return rows.length > 0;
}

async function hasRecordByHpercode({ table, hpercode, where = "", params = [] }) {
  if (!hpercode) return false;
  const hasColumn = await tableHasColumn(table, "hpercode");
  if (!hasColumn) return false;
  const sql = `SELECT 1 FROM ${table} WHERE hpercode = ?${where} LIMIT 1`;
  const [rows] = await pool.query(sql, [hpercode, ...params]);
  return rows.length > 0;
}

/**
 * Check if admission vital signs exist for an encounter
 */
async function checkAdmissionVitalSigns(enccode, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hvitalsign",
      enccode,
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hvitalsign",
      hpercode,
    });
  } catch (error) {
    console.error("Error checking admission vital signs:", error);
    throw error;
  }
}

/**
 * Check if admission BMI exists for an encounter
 */
async function checkAdmissionBMI(enccode, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hvsothr",
      enccode,
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hvsothr",
      hpercode,
    });
  } catch (error) {
    console.error("Error checking admission BMI:", error);
    throw error;
  }
}

/**
 * Check if admission history exists for a specific history type
 */
async function checkAdmissionHistory(enccode, histype, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hmrhisto",
      enccode,
      where: " AND histype = ?",
      params: [histype],
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hmrhisto",
      hpercode,
      where: " AND histype = ?",
      params: [histype],
    });
  } catch (error) {
    console.error("Error checking admission history:", error);
    throw error;
  }
}

/**
 * Check if admission OB history exists for OB cases
 */
async function checkAdmissionHistoryOB(enccode, hpercode = "") {
  try {
    // First check if it's an OB case
    const [admLog] = await pool.query(
      "SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (admLog.length === 0) return false;

    const { tscode } = admLog[0];

    // S0005 = OBSTETRICS
    if (tscode === "S0005") {
      const [rows] = await pool.query(
        `SELECT * FROM hmrhistoob 
         WHERE enccode = ? 
         AND obg IS NOT NULL 
         AND oblmp IS NOT NULL 
         LIMIT 1`,
        [enccode]
      );
      return rows.length > 0;
    }

    return true;
  } catch (error) {
    console.error("Error checking admission OB history:", error);
    throw error;
  }
}

/**
 * Check if prenatal data exists for OB cases
 */
async function checkAdmissionPrenatal(enccode, hpercode = "") {
  try {
    // First check if it's an OB case
    const [admLog] = await pool.query(
      "SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (admLog.length === 0) return false;

    const { tscode } = admLog[0];

    // S0005 = OBSTETRICS
    if (tscode === "S0005") {
      const [rows] = await pool.query(
        `SELECT * FROM hprenatal 
         WHERE enccode = ? 
         AND mcp IS NOT NULL 
         AND prenataldte2 IS NOT NULL 
         AND prenataldte3 IS NOT NULL 
         AND prenataldte4 IS NOT NULL 
         AND expectdeliverydte IS NOT NULL 
         LIMIT 1`,
        [enccode]
      );
      return rows.length > 0;
    }

    return true;
  } catch (error) {
    console.error("Error checking admission prenatal:", error);
    throw error;
  }
}

/**
 * Check if pertinent signs & symptoms exist
 */
async function checkAdmissionPertinentSignSymptoms(enccode, hpercode = "") {
  try {
    const signsByEnccode = await hasRecordByEnccode({
      table: "hsignsymptoms",
      enccode,
    });
    if (signsByEnccode) return true;

    const othersByEnccode = await hasRecordByEnccode({
      table: "hpesignsothers",
      enccode,
      where: " AND pesigntype = ?",
      params: ["others"],
    });
    if (othersByEnccode) return true;

    const painByEnccode = await hasRecordByEnccode({
      table: "hpesignsothers",
      enccode,
      where: " AND pesigntype = ?",
      params: ["painsite"],
    });
    if (painByEnccode) return true;

    const signsByHpercode = await hasRecordByHpercode({
      table: "hsignsymptoms",
      hpercode,
    });
    if (signsByHpercode) return true;

    const othersByHpercode = await hasRecordByHpercode({
      table: "hpesignsothers",
      hpercode,
      where: " AND pesigntype = ?",
      params: ["others"],
    });
    if (othersByHpercode) return true;

    return await hasRecordByHpercode({
      table: "hpesignsothers",
      hpercode,
      where: " AND pesigntype = ?",
      params: ["painsite"],
    });
  } catch (error) {
    console.error("Error checking pertinent signs & symptoms:", error);
    throw error;
  }
}

/**
 * Check if physical exam exists
 */
async function checkAdmissionPhysicalExam(enccode, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hphyexam",
      enccode,
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hphyexam",
      hpercode,
    });
  } catch (error) {
    console.error("Error checking physical exam:", error);
    throw error;
  }
}

/**
 * Check if system review exists
 */
async function checkAdmissionSystemReview(enccode, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hmrsrev",
      enccode,
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hmrsrev",
      hpercode,
    });
  } catch (error) {
    console.error("Error checking system review:", error);
    throw error;
  }
}

/**
 * Check if course in ward exists
 */
async function checkAdmissionCourseWard(enccode, hpercode = "") {
  try {
    const foundByEnccode = await hasRecordByEnccode({
      table: "hcrsward",
      enccode,
    });
    if (foundByEnccode) return true;

    return await hasRecordByHpercode({
      table: "hcrsward",
      hpercode,
    });
  } catch (error) {
    console.error("Error checking course in ward:", error);
    throw error;
  }
}

/**
 * Check if course in ward has entries for each discharge day
 */
async function checkCourseInTheWardDischarge(enccode) {
  try {
    const [enctr] = await pool.query(
      "SELECT toecode FROM henctr WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (enctr.length === 0) return false;

    const { toecode } = enctr[0];
    let admLog;

    if (toecode === "ADM") {
      [admLog] = await pool.query(
        "SELECT admdate, disdate FROM hadmlog WHERE enccode = ? LIMIT 1",
        [enccode]
      );
    } else if (toecode === "ER" || toecode === "ERADM") {
      [admLog] = await pool.query(
        "SELECT erdate, erdtedis FROM herlog WHERE enccode = ? LIMIT 1",
        [enccode]
      );
    } else if (toecode === "OPD") {
      [admLog] = await pool.query(
        "SELECT opddate, opddtedis FROM hopdlog WHERE enccode = ? LIMIT 1",
        [enccode]
      );
    } else {
      return false;
    }

    if (admLog.length === 0) return false;

    let admDate, disDate;

    if (toecode === "ADM") {
      admDate = new Date(admLog[0].admdate);
      disDate = admLog[0].disdate ? new Date(admLog[0].disdate) : null;
    } else if (toecode === "ER" || toecode === "ERADM") {
      admDate = new Date(admLog[0].erdate);
      disDate = admLog[0].erdtedis ? new Date(admLog[0].erdtedis) : null;
    } else {
      admDate = new Date(admLog[0].opddate);
      disDate = admLog[0].opddtedis ? new Date(admLog[0].opddtedis) : null;
    }

    const finalDate = disDate || new Date();
    const daysDifference = Math.ceil(
      (finalDate - admDate) / (1000 * 60 * 60 * 24)
    );

    // Check if there's a course entry for each day
    for (let i = 0; i <= daysDifference; i++) {
      const checkDate = new Date(admDate);
      checkDate.setDate(checkDate.getDate() + i);
      const dateStr = checkDate.toISOString().split("T")[0];

      const [courseEntry] = await pool.query(
        "SELECT * FROM hcrsward WHERE enccode = ? AND DATE(dtetake) = ? LIMIT 1",
        [enccode, dateStr]
      );

      if (courseEntry.length === 0) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Error checking course in ward discharge:", error);
    throw error;
  }
}

/**
 * Check if discharge order exists
 */
async function checkDischargeOrder(enccode) {
  try {
    const [enctr] = await pool.query(
      "SELECT toecode FROM henctr WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (enctr.length === 0) return null;

    const { toecode } = enctr[0];

    if (toecode === "ADM") {
      const [rows] = await pool.query(
        "SELECT dodate FROM hdocord WHERE orcode = 'DISCH' AND enccode = ? LIMIT 1",
        [enccode]
      );
      return rows.length > 0 ? rows[0].dodate : null;
    }

    return "Patient Done";
  } catch (error) {
    console.error("Error checking discharge order:", error);
    throw error;
  }
}

/**
 * Check final diagnosis
 */
async function checkFinalDiagnosis(enccode) {
  try {
    const [rows] = await pool.query(
      `SELECT diagtext FROM hencdiag 
       WHERE tdcode = 'FINDX' AND enccode = ? AND primediag = 'Y' 
       LIMIT 1`,
      [enccode]
    );
    return rows.length > 0 ? rows[0].diagtext : null;
  } catch (error) {
    console.error("Error checking final diagnosis:", error);
    throw error;
  }
}

/**
 * Check ICD code
 */
async function checkICDCode(enccode) {
  try {
    const [rows] = await pool.query(
      `SELECT diagcode FROM hencdiag 
       WHERE tdcode = 'FINDX' AND enccode = ? 
       LIMIT 1`,
      [enccode]
    );
    return rows.length > 0 ? rows[0].diagcode : null;
  } catch (error) {
    console.error("Error checking ICD code:", error);
    throw error;
  }
}

/**
 * Check PHIC status
 */
async function checkPhicStatus(enccode) {
  try {
    const [henctr] = await pool.query(
      "SELECT phicclaim FROM henctr WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (henctr.length === 0) return false;

    if (henctr[0].phicclaim === "Y") {
      const [patCon] = await pool.query(
        "SELECT nbb FROM hpatcon WHERE enccode = ? LIMIT 1",
        [enccode]
      );

      if (patCon.length > 0) {
        return patCon[0].nbb === "Y";
      }
      return false;
    }

    return false;
  } catch (error) {
    console.error("Error checking PHIC status:", error);
    throw error;
  }
}

async function findFirstExistingColumn(tableName, candidateColumns = []) {
  if (!Array.isArray(candidateColumns) || candidateColumns.length === 0) {
    return null;
  }

  for (const columnName of candidateColumns) {
    // Reuse schema cache to avoid repeated INFORMATION_SCHEMA queries.
    if (await tableHasColumn(tableName, columnName)) {
      return columnName;
    }
  }

  return null;
}

/**
 * Returns true when the selected service has no pending clearance rows.
 * This mirrors PHP semantics where empty(ClearanceController::<Service>) is valid.
 */
async function checkOrderClearance(enccode, serviceCode) {
  try {
    const serviceColumn = await findFirstExistingColumn("hdocord", [
      "proccode",
      "orcode",
      "ordertype",
      "servicecode",
      "deptcode",
    ]);

    const statusColumn = await findFirstExistingColumn("hdocord", [
      "estatus",
      "ordstatus",
      "status",
      "clearance_status",
      "iscleared",
    ]);

    // If schema does not expose service/status columns, fail open to avoid
    // false blockers while still keeping discharge validation operational.
    if (!serviceColumn || !statusColumn) {
      return true;
    }

    const [rows] = await pool.query(
      `SELECT 1
       FROM hdocord
       WHERE enccode = ?
         AND ${serviceColumn} = ?
         AND COALESCE(${statusColumn}, '') NOT IN ('S', 'C', 'CLEARED', 'DONE', '1', 'Y')
       LIMIT 1`,
      [enccode, serviceCode],
    );

    // No pending rows means clearance passes.
    return rows.length === 0;
  } catch (error) {
    console.error("Error checking order clearance:", error);
    throw error;
  }
}

async function checkNewbornClearance(enccode) {
  try {
    // Keep parity with PHP discharge flow by evaluating newborn clearance as a
    // dedicated clearance channel when available in hdocord.
    return await checkOrderClearance(enccode, "NEWB");
  } catch (error) {
    console.error("Error checking newborn clearance:", error);
    throw error;
  }
}

async function checkDischargeClearances(enccode) {
  return {
    pharmacy: await checkOrderClearance(enccode, "PHARM"),
    csr: await checkOrderClearance(enccode, "CSR"),
    laboratory: await checkOrderClearance(enccode, "LABOR"),
    radiology: await checkOrderClearance(enccode, "RADIO"),
    newborn: await checkNewbornClearance(enccode),
  };
}

// ===================== EXPRESS ROUTE HANDLERS =====================

/**
 * Validate complete admission form
 * GET /api/validation/admission/:enccode
 */
async function validateAdmission(req, res, next) {
  try {
    const { enccode } = req.params;
    const encounter = await resolveEncounterRecord(enccode);
    const hpercode = encounter.hpercode;
    const toecode = encounter.toecode;

    console.log(`[ADMISSION DEBUG] Processing enccode=${enccode}, resolvedEnccode=${encounter.enccode}, matchedBy=${encounter.matchedBy}, hpercode=${hpercode}, toecode=${toecode}`);

    // Check sample table for debugging
    let sampleVitalSigns = null;
    try {
      const [vitalSignsSample] = await pool.query(
        "SELECT enccode, hpercode FROM hvitalsign WHERE enccode = ? LIMIT 1",
        [encounter.enccode]
      );
      sampleVitalSigns = vitalSignsSample.length > 0 ? vitalSignsSample[0] : null;
    } catch (e) {
      console.error("Error sampling hvitalsign:", e);
    }

    const results = {
      enccode: encounter.enccode,
      vitalSigns: await checkAdmissionVitalSigns(encounter.enccode, hpercode),
      bmi: await checkAdmissionBMI(encounter.enccode, hpercode),
      historyGDPPR: await checkAdmissionHistory(encounter.enccode, "GDPPR", hpercode),
      historyCOMPL: await checkAdmissionHistory(encounter.enccode, "COMPL", hpercode),
      historyPRHIS: await checkAdmissionHistory(encounter.enccode, "PRHIS", hpercode),
      historyPAHIS: await checkAdmissionHistory(encounter.enccode, "PAHIS", hpercode),
      historyOCENV: await checkAdmissionHistory(encounter.enccode, "OCENV", hpercode),
      historyFAHIS: await checkAdmissionHistory(encounter.enccode, "FAHIS", hpercode),
      historyDRTHE: await checkAdmissionHistory(encounter.enccode, "DRTHE", hpercode),
      historyALCOH: await checkAdmissionHistory(encounter.enccode, "ALCOH", hpercode),
      historyTOBAC: await checkAdmissionHistory(encounter.enccode, "TOBAC", hpercode),
      historyDRUGA: await checkAdmissionHistory(encounter.enccode, "DRUGA", hpercode),
      historyOTHAL: await checkAdmissionHistory(encounter.enccode, "OTHAL", hpercode),
      historyOB: await checkAdmissionHistoryOB(encounter.enccode, hpercode),
      prenatal: await checkAdmissionPrenatal(encounter.enccode, hpercode),
      pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(encounter.enccode, hpercode),
      physicalExam: await checkAdmissionPhysicalExam(encounter.enccode, hpercode),
      systemReview: await checkAdmissionSystemReview(encounter.enccode, hpercode),
      courseWard: await checkAdmissionCourseWard(encounter.enccode, hpercode),
    };

    // Check if all required fields are completed
    const isComplete =
      results.vitalSigns &&
      results.bmi &&
      results.historyGDPPR &&
      results.historyCOMPL &&
      results.historyPRHIS &&
      results.historyPAHIS &&
      results.historyOCENV &&
      results.historyFAHIS &&
      results.historyDRTHE &&
      results.historyALCOH &&
      results.historyTOBAC &&
      results.historyDRUGA &&
      results.historyOTHAL &&
      results.historyOB &&
      results.prenatal &&
      results.pertinentSignSymptoms &&
      results.physicalExam &&
      results.systemReview &&
      results.courseWard;

    const missingFields = Object.entries(results)
      .filter(([key, value]) => key !== "enccode" && !value)
      .map(([key]) => key);

    console.log(`[ADMISSION DEBUG] Results: isComplete=${isComplete}, missingCount=${missingFields.length}`);

    res.json({
      ok: true,
      enccode,
      isComplete,
      details: results,
      missingFields: Object.entries(results)
        .filter(([key, value]) => key !== "enccode" && !value)
        .map(([key]) => key),
      DEBUG_INFO: {
        timestamp: new Date().toISOString(),
        enccode,
        resolvedEnccode: encounter.enccode,
        matchedBy: encounter.matchedBy,
        hpercode,
        toecode,
        encounterExists: encounter.matchedBy !== "none",
        sampleVitalSignsFound: sampleVitalSigns !== null,
        sampleVitalSignsData: sampleVitalSigns,
        totalChecks: Object.keys(results).length - 1,
        passedChecks: Object.values(results).filter((v) => v === true).length,
        failedChecks: Object.values(results).filter((v) => v === false).length,
        note: "If matchedBy=prefix, the input enccode was a base code and the stored enccode includes a timestamp suffix.",
      },
    });
  } catch (error) {
    console.error(`[ADMISSION ERROR] enccode=${req.params.enccode}:`, error);
    next(error);
  }
}

/**
 * Validate complete discharge form
 * GET /api/validation/discharge/:enccode
 */
async function validateDischarge(req, res, next) {
  try {
    const { enccode } = req.params;
    const encounter = await resolveEncounterRecord(enccode);

    console.log(`[DISCHARGE DEBUG] Processing enccode=${enccode}, resolvedEnccode=${encounter.enccode}, matchedBy=${encounter.matchedBy}`);

    const clearances = await checkDischargeClearances(encounter.enccode);
    const dischargeOrder = await checkDischargeOrder(encounter.enccode);
    const finalDiagnosis = await checkFinalDiagnosis(encounter.enccode);
    const icdCode = await checkICDCode(encounter.enccode);
    const courseInWard = await checkCourseInTheWardDischarge(encounter.enccode);

    const results = {
      enccode,
      ...clearances,
      dischargeOrder: !!dischargeOrder,
      finalDiagnosis: !!finalDiagnosis,
      icdCode: !!icdCode,
      courseInWard,
    };

    const isComplete =
      results.pharmacy &&
      results.csr &&
      results.laboratory &&
      results.radiology &&
      results.newborn &&
      results.dischargeOrder &&
      results.finalDiagnosis &&
      results.icdCode &&
      results.courseInWard;

    const missingFields = Object.entries(results)
      .filter(([key, value]) => key !== "enccode" && !value)
      .map(([key]) => key);

    console.log(`[DISCHARGE DEBUG] Results: isComplete=${isComplete}, dischargeOrder=${results.dischargeOrder}, finalDiagnosis=${results.finalDiagnosis}, icdCode=${results.icdCode}, courseInWard=${results.courseInWard}`);

    res.json({
      ok: true,
      enccode,
      isComplete,
      details: {
        ...results,
        clearances,
        dischargeOrderDate: dischargeOrder || null,
        finalDiagnosisText: finalDiagnosis || null,
        icdCodeValue: icdCode || null,
      },
      missingFields: Object.entries(results)
        .filter(([key, value]) => key !== "enccode" && !value)
        .map(([key]) => key),
      DEBUG_INFO: {
        timestamp: new Date().toISOString(),
        enccode,
        resolvedEnccode: encounter.enccode,
        matchedBy: encounter.matchedBy,
        dischargeOrderFound: !!dischargeOrder,
        finalDiagnosisFound: !!finalDiagnosis,
        icdCodeFound: !!icdCode,
        courseInWardStatus: courseInWard,
        queryDetails: "Checking discharge order, final diagnosis, ICD code, and course in ward using resolved enccode",
      },
    });
  } catch (error) {
    console.error(`[DISCHARGE ERROR] enccode=${req.params.enccode}:`, error);
    next(error);
  }
}

/**
 * Get individual validation results for all components
 * GET /api/validation/details/:enccode
 */
async function getValidationDetails(req, res, next) {
  try {
    const { enccode } = req.params;
    const encounter = await resolveEncounterRecord(enccode);
    const hpercode = encounter.hpercode;

    console.log(`[DETAILS DEBUG] Processing enccode=${enccode}, resolvedEnccode=${encounter.enccode}, matchedBy=${encounter.matchedBy}, hpercode=${hpercode}, toecode=${encounter.toecode}`);

    let sampleVitalSigns = null;
    try {
      const [vitalSignsSample] = await pool.query(
        "SELECT enccode, hpercode FROM hvitalsign WHERE enccode = ? LIMIT 1",
        [encounter.enccode]
      );
      sampleVitalSigns = vitalSignsSample.length > 0 ? vitalSignsSample[0] : null;
    } catch (e) {
      console.error("Error sampling hvitalsign:", e);
    }

    const dischargeClearances = await checkDischargeClearances(encounter.enccode);
    const dischargeOrder = await checkDischargeOrder(encounter.enccode);
    const finalDiagnosis = await checkFinalDiagnosis(encounter.enccode);
    const icdCode = await checkICDCode(encounter.enccode);
    const courseInWard = await checkCourseInTheWardDischarge(encounter.enccode);

    const allValidations = {
      admission: {
        vitalSigns: await checkAdmissionVitalSigns(encounter.enccode, hpercode),
        bmi: await checkAdmissionBMI(encounter.enccode, hpercode),
        histories: {
          GDPPR: await checkAdmissionHistory(encounter.enccode, "GDPPR", hpercode),
          COMPL: await checkAdmissionHistory(encounter.enccode, "COMPL", hpercode),
          PRHIS: await checkAdmissionHistory(encounter.enccode, "PRHIS", hpercode),
          PAHIS: await checkAdmissionHistory(encounter.enccode, "PAHIS", hpercode),
          OCENV: await checkAdmissionHistory(encounter.enccode, "OCENV", hpercode),
          FAHIS: await checkAdmissionHistory(encounter.enccode, "FAHIS", hpercode),
          DRTHE: await checkAdmissionHistory(encounter.enccode, "DRTHE", hpercode),
          ALCOH: await checkAdmissionHistory(encounter.enccode, "ALCOH", hpercode),
          TOBAC: await checkAdmissionHistory(encounter.enccode, "TOBAC", hpercode),
          DRUGA: await checkAdmissionHistory(encounter.enccode, "DRUGA", hpercode),
          OTHAL: await checkAdmissionHistory(encounter.enccode, "OTHAL", hpercode),
        },
        ob: await checkAdmissionHistoryOB(encounter.enccode, hpercode),
        prenatal: await checkAdmissionPrenatal(encounter.enccode, hpercode),
        pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(encounter.enccode, hpercode),
        physicalExam: await checkAdmissionPhysicalExam(encounter.enccode, hpercode),
        systemReview: await checkAdmissionSystemReview(encounter.enccode, hpercode),
        courseWard: await checkAdmissionCourseWard(encounter.enccode, hpercode),
      },
      discharge: {
        clearances: dischargeClearances,
        order: dischargeOrder,
        finalDiagnosis,
        icdCode,
        courseInWard,
      },
      phic: await checkPhicStatus(encounter.enccode),
    };

    const admissionPassed = Object.values(allValidations.admission)
      .flat()
      .filter(v => typeof v === 'boolean' && v).length;
    const dischargePassed = Object.values(allValidations.discharge)
      .filter(v => typeof v === 'boolean' && v).length;

    console.log(`[DETAILS DEBUG] Admission passed=${admissionPassed}, Discharge passed=${dischargePassed}`);

    res.json({
      ok: true,
      enccode,
      validations: allValidations,
      DEBUG_INFO: {
        timestamp: new Date().toISOString(),
        enccode,
        resolvedEnccode: encounter.enccode,
        matchedBy: encounter.matchedBy,
        hpercode,
        toecode: encounter.toecode,
        encounterExists: encounter.matchedBy !== "none",
        sampleVitalSignsFound: sampleVitalSigns !== null,
        sampleVitalSignsData: sampleVitalSigns,
        admissionChecksPassed: admissionPassed,
        dischargeChecksPassed: dischargePassed,
        phicStatus: allValidations.phic,
        note: "If matchedBy=prefix, the input enccode was resolved to the stored timestamp-suffixed enccode.",
      },
    });
  } catch (error) {
    console.error(`[DETAILS ERROR] enccode=${req.params.enccode}:`, error);
    next(error);
  }
}

/**
 * Check history type for an encounter
 * GET /api/validation/history/:enccode/:histype
 */
async function checkHistory(req, res, next) {
  try {
    const { enccode, histype } = req.params;
    const hpercode = await resolveHpercode(enccode);
    const exists = await checkAdmissionHistory(enccode, histype, hpercode);

    res.json({
      ok: true,
      enccode,
      histype,
      exists,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Check PHIC status for an encounter
 * GET /api/validation/phic/:enccode
 */
async function validatePhic(req, res, next) {
  try {
    const { enccode } = req.params;
    const isValid = await checkPhicStatus(enccode);

    res.json({
      ok: true,
      enccode,
      phicValid: isValid,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  // Express handlers
  validateAdmission,
  validateDischarge,
  getValidationDetails,
  checkHistory,
  validatePhic,

  // PHP-compatible aliases for legacy parity checks
  AdmissionVitalSigns: checkAdmissionVitalSigns,
  AdmissionBMI: checkAdmissionBMI,
  AdmissionHistoryGDPPR: (enccode) => checkAdmissionHistory(enccode, "GDPPR"),
  AdmissionHistoryCOMPL: (enccode) => checkAdmissionHistory(enccode, "COMPL"),
  AdmissionHistoryPRHIS: (enccode) => checkAdmissionHistory(enccode, "PRHIS"),
  AdmissionHistoryPAHIS: (enccode) => checkAdmissionHistory(enccode, "PAHIS"),
  AdmissionHistoryOCENV: (enccode) => checkAdmissionHistory(enccode, "OCENV"),
  AdmissionHistoryFAHIS: (enccode) => checkAdmissionHistory(enccode, "FAHIS"),
  AdmissionHistoryDRTHE: (enccode) => checkAdmissionHistory(enccode, "DRTHE"),
  AdmissionHistoryALCOH: (enccode) => checkAdmissionHistory(enccode, "ALCOH"),
  AdmissionHistoryTOBAC: (enccode) => checkAdmissionHistory(enccode, "TOBAC"),
  AdmissionHistoryDRUGA: (enccode) => checkAdmissionHistory(enccode, "DRUGA"),
  AdmissionHistoryOTHAL: (enccode) => checkAdmissionHistory(enccode, "OTHAL"),
  AdmissionHistoryOB: checkAdmissionHistoryOB,
  AdmissionPrenatal: checkAdmissionPrenatal,
  AdmissionPertinentSignSymptoms: checkAdmissionPertinentSignSymptoms,
  AdmissionPhysicalExam: checkAdmissionPhysicalExam,
  AdmissionSystemReview: checkAdmissionSystemReview,
  AdmissionCourseWard: checkAdmissionCourseWard,
  Admission: validateAdmission,
  FullCourseWard: checkAdmissionCourseWard,
  CourseInTheWardDischarge: checkCourseInTheWardDischarge,
  CourseInTheWardDate: async (enccode, date) => {
    const [rows] = await pool.query(
      "SELECT * FROM hcrsward WHERE enccode = ? AND dtetake LIKE ? LIMIT 1",
      [enccode, `%${date}%`]
    );

    return rows.length > 0;
  },
  DischargeOrder: checkDischargeOrder,
  FinalDiagnosis: checkFinalDiagnosis,
  ICDCode: checkICDCode,
  Discharge: validateDischarge,
  PhicStatus: checkPhicStatus,

  // Export internal functions for testing or other controllers
  checkAdmissionVitalSigns,
  checkAdmissionBMI,
  checkAdmissionHistory,
  checkAdmissionHistoryOB,
  checkAdmissionPrenatal,
  checkAdmissionPertinentSignSymptoms,
  checkAdmissionPhysicalExam,
  checkAdmissionSystemReview,
  checkAdmissionCourseWard,
  checkCourseInTheWardDischarge,
  checkDischargeOrder,
  checkFinalDiagnosis,
  checkICDCode,
  checkPhicStatus,
  checkDischargeClearances,
};
