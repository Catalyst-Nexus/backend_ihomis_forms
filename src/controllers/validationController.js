const pool = require("../config/db");

function buildMissingFields(results) {
  return Object.entries(results)
    .filter(([key, value]) => key !== "enccode" && !value)
    .map(([key]) => key);
}

/**
 * Check if admission vital signs exist for an encounter
 */
async function checkAdmissionVitalSigns(enccode) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hvitalsign WHERE enccode = ? LIMIT 1",
      [enccode]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking admission vital signs:", error);
    throw error;
  }
}

/**
 * Check if admission BMI exists for an encounter
 */
async function checkAdmissionBMI(enccode) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hvsothr WHERE enccode = ? LIMIT 1",
      [enccode]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking admission BMI:", error);
    throw error;
  }
}

/**
 * Check if admission history exists for a specific history type
 */
async function checkAdmissionHistory(enccode, histype) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hmrhisto WHERE enccode = ? AND histype = ? LIMIT 1",
      [enccode, histype]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking admission history:", error);
    throw error;
  }
}

/**
 * Check if admission OB history exists for OB cases
 */
async function checkAdmissionHistoryOB(enccode) {
  try {
    // First check if it's an OB case
    const [admLog] = await pool.query(
      "SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (admLog.length === 0) return false;

    const { tscode } = admLog[0];

    // S0005 = OBSTETRICS
    if (String(tscode || "").toUpperCase() === "S0005") {
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
async function checkAdmissionPrenatal(enccode) {
  try {
    // First check if it's an OB case
    const [admLog] = await pool.query(
      "SELECT tscode FROM hadmlog WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (admLog.length === 0) return false;

    const { tscode } = admLog[0];

    // S0005 = OBSTETRICS
    if (String(tscode || "").toUpperCase() === "S0005") {
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
async function checkAdmissionPertinentSignSymptoms(enccode) {
  try {
    // Check signs and symptoms
    const [signsSymptoms] = await pool.query(
      "SELECT * FROM hsignsymptoms WHERE enccode = ? LIMIT 1",
      [enccode]
    );

    if (signsSymptoms.length > 0) return true;

    // Check others
    const [others] = await pool.query(
      "SELECT * FROM hpesignsothers WHERE enccode = ? AND pesigntype = 'others' LIMIT 1",
      [enccode]
    );

    if (others.length > 0) return true;

    // Check pain site
    const [pain] = await pool.query(
      "SELECT * FROM hpesignsothers WHERE enccode = ? AND pesigntype = 'painsite' LIMIT 1",
      [enccode]
    );

    return pain.length > 0;
  } catch (error) {
    console.error("Error checking pertinent signs & symptoms:", error);
    throw error;
  }
}

/**
 * Check if physical exam exists
 */
async function checkAdmissionPhysicalExam(enccode) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hphyexam WHERE enccode = ? LIMIT 1",
      [enccode]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking physical exam:", error);
    throw error;
  }
}

/**
 * Check if system review exists
 */
async function checkAdmissionSystemReview(enccode) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hmrsrev WHERE enccode = ? LIMIT 1",
      [enccode]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error checking system review:", error);
    throw error;
  }
}

/**
 * Check if course in ward exists
 */
async function checkAdmissionCourseWard(enccode) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM hcrsward WHERE enccode = ? LIMIT 1",
      [enccode]
    );
    return rows.length > 0;
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

// ===================== EXPRESS ROUTE HANDLERS =====================

/**
 * Validate complete admission form
 * GET /api/validation/admission/:enccode
 */
async function validateAdmission(req, res, next) {
  try {
    const { enccode } = req.params;

    const results = {
      enccode,
      vitalSigns: await checkAdmissionVitalSigns(enccode),
      bmi: await checkAdmissionBMI(enccode),
      historyGDPPR: await checkAdmissionHistory(enccode, "GDPPR"),
      historyCOMPL: await checkAdmissionHistory(enccode, "COMPL"),
      historyPRHIS: await checkAdmissionHistory(enccode, "PRHIS"),
      historyPAHIS: await checkAdmissionHistory(enccode, "PAHIS"),
      historyOCENV: await checkAdmissionHistory(enccode, "OCENV"),
      historyFAHIS: await checkAdmissionHistory(enccode, "FAHIS"),
      historyDRTHE: await checkAdmissionHistory(enccode, "DRTHE"),
      historyALCOH: await checkAdmissionHistory(enccode, "ALCOH"),
      historyTOBAC: await checkAdmissionHistory(enccode, "TOBAC"),
      historyDRUGA: await checkAdmissionHistory(enccode, "DRUGA"),
      historyOTHAL: await checkAdmissionHistory(enccode, "OTHAL"),
      historyOB: await checkAdmissionHistoryOB(enccode),
      prenatal: await checkAdmissionPrenatal(enccode),
      pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(enccode),
      physicalExam: await checkAdmissionPhysicalExam(enccode),
      systemReview: await checkAdmissionSystemReview(enccode),
      courseWard: await checkAdmissionCourseWard(enccode),
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

    res.json({
      ok: true,
      enccode,
      isComplete,
      details: results,
      missingFields: buildMissingFields(results),
    });
  } catch (error) {
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

    const dischargeOrder = await checkDischargeOrder(enccode);
    const finalDiagnosis = await checkFinalDiagnosis(enccode);
    const icdCode = await checkICDCode(enccode);
    const courseInWard = await checkCourseInTheWardDischarge(enccode);

    const results = {
      enccode,
      dischargeOrder: !!dischargeOrder,
      finalDiagnosis: !!finalDiagnosis,
      icdCode: !!icdCode,
      courseInWard,
    };

    const isComplete =
      results.dischargeOrder &&
      results.finalDiagnosis &&
      results.icdCode &&
      results.courseInWard;

    res.json({
      ok: true,
      enccode,
      isComplete,
      details: {
        ...results,
        dischargeOrderDate: dischargeOrder || null,
        finalDiagnosisText: finalDiagnosis || null,
        icdCodeValue: icdCode || null,
      },
      missingFields: buildMissingFields(results),
    });
  } catch (error) {
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

    const allValidations = {
      admission: {
        vitalSigns: await checkAdmissionVitalSigns(enccode),
        bmi: await checkAdmissionBMI(enccode),
        histories: {
          GDPPR: await checkAdmissionHistory(enccode, "GDPPR"),
          COMPL: await checkAdmissionHistory(enccode, "COMPL"),
          PRHIS: await checkAdmissionHistory(enccode, "PRHIS"),
          PAHIS: await checkAdmissionHistory(enccode, "PAHIS"),
          OCENV: await checkAdmissionHistory(enccode, "OCENV"),
          FAHIS: await checkAdmissionHistory(enccode, "FAHIS"),
          DRTHE: await checkAdmissionHistory(enccode, "DRTHE"),
          ALCOH: await checkAdmissionHistory(enccode, "ALCOH"),
          TOBAC: await checkAdmissionHistory(enccode, "TOBAC"),
          DRUGA: await checkAdmissionHistory(enccode, "DRUGA"),
          OTHAL: await checkAdmissionHistory(enccode, "OTHAL"),
        },
        ob: await checkAdmissionHistoryOB(enccode),
        prenatal: await checkAdmissionPrenatal(enccode),
        pertinentSignSymptoms: await checkAdmissionPertinentSignSymptoms(enccode),
        physicalExam: await checkAdmissionPhysicalExam(enccode),
        systemReview: await checkAdmissionSystemReview(enccode),
        courseWard: await checkAdmissionCourseWard(enccode),
      },
      discharge: {
        order: await checkDischargeOrder(enccode),
        finalDiagnosis: await checkFinalDiagnosis(enccode),
        icdCode: await checkICDCode(enccode),
        courseInWard: await checkCourseInTheWardDischarge(enccode),
      },
      phic: await checkPhicStatus(enccode),
    };

    res.json({
      ok: true,
      enccode,
      validations: allValidations,
    });
  } catch (error) {
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
    const exists = await checkAdmissionHistory(enccode, histype);

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
};
