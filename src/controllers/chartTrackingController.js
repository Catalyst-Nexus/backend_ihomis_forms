const pool = require("../config/db");
const { mapSex } = require("../utils/dbHelpers");

/**
 * SQL CASE statement to detect encounter type based on:
 * 1. Primary: henctr.toecode (encounter type of encounter code)
 * 2. Fallback: hadmlog.typadm (admission type)
 * 3. Fallback: Presence of admission dates
 * 
 * Supported codes:
 * - ER/Emergency: E, ER, ERADM, ERD
 * - OPD/Outpatient: O, OP, OPD
 * - ADM/Inpatient: A, ADM, IPD, INP
 */
const ENCOUNTER_TYPE_SQL = `
  CASE
    -- Check for ER patterns first (including ERADM, ERD, E, etc.)
    WHEN UPPER(COALESCE(hen.toecode, '')) LIKE '%ER%' OR UPPER(COALESCE(hen.toecode, '')) IN ('E') THEN 'ER'
    WHEN UPPER(COALESCE(hen.toecode, '')) IN ('OPD', 'OP', 'O') THEN 'OPD'
    WHEN UPPER(COALESCE(hen.toecode, '')) IN ('ADM', 'IPD', 'A', 'INP') THEN 'ADM'
    -- Fallback: check if there's admission data
    WHEN COALESCE(hadm.typadm, '') <> '' THEN 'ADM'
    WHEN COALESCE(hadm.admdate, '') <> '' OR COALESCE(hadm.disdate, '') <> '' THEN 'ADM'
    -- Default case for unknown types
    ELSE 'UNKNOWN'
  END
`;

/**
 * GET /api/db/chart-tracking
 * 
 * Fetch chart tracking data for CHART Management System
 * Supports filtering by encounter type (ER, OPD, ADM) and various criteria
 * 
 * Query Parameters:
 * - type: 'ER' | 'OPD' | 'ADM' - Filter by encounter type (optional)
 * - hpercode: Patient code (optional)
 * - enccode: Encounter code (optional)
 * - search: Search patient name/code (optional)
 * - dischargedDate: YYYY-MM-DD - Filter by exact discharge date (optional)
 * - admissionDateFrom: YYYY-MM-DD - Range filter start (optional)
 * - admissionDateTo: YYYY-MM-DD - Range filter end (optional)
 * - limit: Number of records (default 50, max 1000)
 * - offset: Pagination offset (default 0)
 * 
 * Response Fields:
 * - enccode: Encounter code (primary key)
 * - patient_id: Patient person code
 * - patient_name: Formatted full name
 * - patient_sex: Gender (mapped)
 * - hospital_no: Hospital admission number
 * - encounter_type: ER, OPD, or ADM
 * - discharged_date: Date/time of discharge (type-specific)
 * - phic: PhilHealth insurance status
 * - records_received: Date/time and remarks of record receipt
 * - verify_status: Verification status (Verified/Not yet Verified)
 * - scan_status: Scanning status (Scanned/Not yet Scanned)
 * - send_status: Sending status
 * - records_filed: Filing status (Filed/Not yet Filed)
 * - claim_map: PHIC claim mapping status
 * - acpn: Account payable check number or claim reference
 */
async function getChartTracking(req, res, next) {
  try {
    const type = String(req.query.type || "").toUpperCase().trim();
    const hpercode = String(req.query.hpercode || "").trim();
    const enccode = String(req.query.enccode || "").trim();
    const search = String(req.query.search || "").trim();
    const dischargedDate = String(req.query.dischargedDate || "").trim();
    const admissionDateFrom = String(req.query.admissionDateFrom || "").trim();
    const admissionDateTo = String(req.query.admissionDateTo || "").trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Validate type filter
    const validTypes = ["ER", "OPD", "ADM"];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({
        ok: false,
        message: "Type must be ER, OPD, or ADM",
      });
    }

    const conditions = [];
    const params = [];

    // Type-based filtering using real schema fields (henctr.toecode + hadmlog.typadm)
    if (type) {
      conditions.push(`${ENCOUNTER_TYPE_SQL} = ?`);
      params.push(type);
    }

    // Patient code filter
    if (hpercode) {
      conditions.push("hen.hpercode = ?");
      params.push(hpercode);
    }

    // Encounter code filter
    if (enccode) {
      conditions.push("hen.enccode = ?");
      params.push(enccode);
    }

    // Search filter (patient name, patient code, encounter code)
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        "(hp.patlast LIKE ? OR hp.patfirst LIKE ? OR hp.hpercode LIKE ? OR hen.enccode LIKE ? OR hadm.pho_hospital_number LIKE ?)"
      );
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    // Exact discharge date filter (YYYY-MM-DD)
    if (dischargedDate) {
      conditions.push("DATE(hadm.disdate) = ?");
      params.push(dischargedDate);
    }

    // Admission date range filters (YYYY-MM-DD)
    if (admissionDateFrom) {
      conditions.push("DATE(hadm.admdate) >= ?");
      params.push(admissionDateFrom);
    }
    if (admissionDateTo) {
      conditions.push("DATE(hadm.admdate) <= ?");
      params.push(admissionDateTo);
    }

    if (!type) {
      conditions.push(`(${ENCOUNTER_TYPE_SQL}) <> 'UNKNOWN'`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // =====================================================
    // MAIN QUERY - Chart Tracking Data Fetch
    // =====================================================
    // This query fetches all required data for chart tracking from multiple tables:
    // 
    // Data Sources by Field:
    // 1. Hospital No. → hadmlog.pho_hospital_number (or fallback to henctr.hpercode)
    // 2. Patient Data → hperson (patlast, patfirst, patmiddle, patsuffix, patsex)
    // 3. Admission Data → hadmlog (admdate, disdate, distime, typadm)
    // 4. ER Data → herlog (erdtedis, ertmedis, erstat, ernotes)
    // 5. OPD Data → hopdlog (opddtedis, opdtmedis, opdstat, opdrem)
    // 6. Chart Tracking → hactrack (reqrecdte, reqrectme, chartdate, charttime, ccsmark, hremarks, billdate)
    // 7. PHIC Claims → hphiclaim (phicstat)
    // 8. Claim Mapping → hphicclaimmap (pClaimNumber, pStatus)
    // 9. Patient Accounts → hpatacct (paacctno)
    //
    // Encounter Type Detection: Uses ENCOUNTER_TYPE_SQL case statement
    // Discharge Date: Type-specific (ADM→disdate, ER→erdtedis, OPD→opddtedis)
    // Records Received: Priority order from hactrack → encounter logs → admission date
    // =====================================================
    
    const [rows] = await pool.query(
      `SELECT
         -- Encounter & Patient Identifiers
         hen.enccode,
         hen.hpercode,
        COALESCE(hadm.pho_hospital_number, hen.hpercode) AS hospital_no,
         hp.hpercode AS patient_id,
         
         -- Patient Demographics (from hperson)
         hp.patlast AS patient_last_name,
         hp.patfirst AS patient_first_name,
         hp.patmiddle AS patient_middle_name,
         hp.patsuffix AS patient_suffix,
         hp.patsex AS patient_sex,
         
         -- Admission Information
         hadm.admdate AS admission_date,
         
         -- Discharge Date (Type-specific: ADM→hadmlog, ER→herlog, OPD→hopdlog)
         MAX(CASE
           WHEN ${ENCOUNTER_TYPE_SQL} = 'ADM' THEN hadm.disdate
           WHEN ${ENCOUNTER_TYPE_SQL} = 'ER' THEN er.erdtedis
           WHEN ${ENCOUNTER_TYPE_SQL} = 'OPD' THEN opl.opddtedis
           ELSE COALESCE(hadm.disdate, er.erdtedis, opl.opddtedis)
         END) AS discharged_date,
         
         -- Discharge Time (Type-specific)
         MAX(CASE
           WHEN ${ENCOUNTER_TYPE_SQL} = 'ADM' THEN hadm.distime
           WHEN ${ENCOUNTER_TYPE_SQL} = 'ER' THEN er.ertmedis
           WHEN ${ENCOUNTER_TYPE_SQL} = 'OPD' THEN opl.opdtmedis
           ELSE COALESCE(hadm.distime, er.ertmedis, opl.opdtmedis)
         END) AS discharged_time,
         
         -- Encounter Type Detection
         ${ENCOUNTER_TYPE_SQL} AS encounter_type,
         hen.encdate AS encounter_date,
         COALESCE(hadm.disdate, hadm.admdate, hen.encdate) AS sort_date,
         hen.encstat AS current_status,
         
         -- PHIC Status (from hphiclaim)
         MAX(COALESCE(ph.phicstat, '')) AS phic_status,
         
         -- Claim Information (from hphicclaimmap)
         MAX(COALESCE(pcm.pClaimNumber, '')) AS claim_number,
         MAX(COALESCE(pcm.pStatus, '')) AS claim_map_status,
         
         -- Patient Account (from hpatacct - for ACPN)
         MAX(COALESCE(pa.paacctno, '')) AS acpn,
         
         -- Records Received (Priority: hactrack → encounter logs → admission date)
         COALESCE(act.reqrecdte, act.chartdate, er.erdate, opl.opddate, hadm.disdate, hadm.admdate) AS records_received_date,
         COALESCE(act.reqrectme, act.charttime, er.ertime, opl.opdtime, hadm.distime, hadm.admtime) AS records_received_time,
         COALESCE(act.hremarks, er.ernotes, opl.opdrem, '') AS records_received_remarks,
         
         -- Verification Status (from ER/OPD/ADM encounter logs)
         MAX(COALESCE(er.erstat, opl.opdstat, '')) AS verify_mark,
         
         -- Scan Status (from hactrack - ccsmark or scan timestamp)
         MAX(COALESCE(act.ccsmark, '')) AS scan_mark,
         act.chartdate AS scan_date,
         act.charttime AS scan_time,
         
         -- Send & File Status (from hactrack and admission data)
         COALESCE(act.billdate, er.erdate, opl.opddate, hadm.admdate) AS send_date,
         hadm.disdate AS bill_date,
         hadm.distime AS bill_time
         
         FROM henctr hen
         INNER JOIN hperson hp ON hp.hpercode = hen.hpercode
         LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
         LEFT JOIN herlog er ON er.enccode = hen.enccode
         LEFT JOIN hopdlog opl ON opl.enccode = hen.enccode
         LEFT JOIN hactrack act ON act.enccode = hen.enccode
         LEFT JOIN hphiclaim ph ON ph.enccode = hen.enccode
         LEFT JOIN hphicclaimmap pcm ON pcm.enccode = hen.enccode
         LEFT JOIN hpatacct pa ON pa.enccode = hen.enccode
         ${whereClause}
         GROUP BY hen.enccode, hen.hpercode, hp.hpercode, hp.patlast, hp.patfirst,
                  hp.patmiddle, hp.patsuffix, hp.patsex, hadm.admdate, hadm.disdate,
                   hadm.distime,
                  hadm.pho_hospital_number, hen.toecode, hadm.typadm, hen.encdate, hen.encstat
         ORDER BY sort_date DESC, hen.encdate DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Count total records
    const countSql = `
      SELECT COUNT(*) as total
      FROM henctr hen
      INNER JOIN hperson hp ON hp.hpercode = hen.hpercode
      LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
      ${whereClause}
    `;
    const [countResult] = await pool.query(countSql, params);
    const total = countResult[0].total;

    // Format response
    const chartData = rows.map((row) => {
      const receivedDetails = getRecordReceivedDetails(row);

      return {
        enccode: row.enccode || "",
        patient_id: row.patient_id || "",
        patient_name: formatPatientName(row),
        patient_sex: mapSex(row.patient_sex),
        hospital_no: row.hospital_no || "",
        encounter_type: row.encounter_type || "",
        discharged_date: formatDateTime(row.discharged_date, row.discharged_time),
        phic: mapPhicStatus(row.phic_status),
        records_received: receivedDetails.display,
        verify_status: mapVerifyStatus(row.verify_mark),
        scan_status: mapScanStatus(row),
        send_status: mapSendStatus(row.send_date),
        records_filed: mapRecordFiled(row.scan_date, row.scan_time),
        claim_map: mapClaimMapStatus(row.claim_map_status),
        acpn: mapAcpn(row.acpn, row.claim_number, row.claim_map_status),
      };
    });

    return res.json({
      ok: true,
      data: chartData,
      pagination: {
        limit,
        offset,
        total,
        pages: Math.ceil(total / limit),
      },
      filters: {
        type: type || "All",
        hpercode: hpercode || null,
        enccode: enccode || null,
        search: search || null,
        dischargedDate: dischargedDate || null,
        admissionDateFrom: admissionDateFrom || null,
        admissionDateTo: admissionDateTo || null,
      },
    });
  } catch (error) {
    console.error("Chart tracking fetch error:", error);
    return res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
}

/**
 * GET /api/db/chart-tracking/summary
 * Get summary statistics for chart tracking by type
 */
async function getChartTrackingSummary(req, res, next) {
  try {
    const type = String(req.query.type || "").toUpperCase().trim();
    const validTypes = ["ER", "OPD", "ADM"];

    const summaryConditions = [];
    const summaryParams = [];
    if (type && validTypes.includes(type)) {
      summaryConditions.push(`${ENCOUNTER_TYPE_SQL} = ?`);
      summaryParams.push(type);
    } else {
      summaryConditions.push(`(${ENCOUNTER_TYPE_SQL}) <> 'UNKNOWN'`);
    }

    const summaryWhere =
      summaryConditions.length > 0
        ? `WHERE ${summaryConditions.join(" AND ")}`
        : "";

    const [stats] = await pool.query(
      `SELECT
         ${ENCOUNTER_TYPE_SQL} AS encounter_type,
         COUNT(DISTINCT hen.enccode) AS total_encounters,
         COUNT(DISTINCT CASE
           WHEN COALESCE(hadm.disdate, '') <> '' THEN hen.enccode
         END) AS discharged
       FROM henctr hen
       LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
       ${summaryWhere}
       GROUP BY encounter_type`,
      summaryParams
    );

    return res.json({
      ok: true,
      data: stats,
    });
  } catch (error) {
    console.error("Chart tracking summary error:", error);
    return res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
}

/**
 * Helper function to format patient name
 */
function formatPatientName(row) {
  const parts = [
    row.patient_last_name,
    row.patient_first_name,
    row.patient_middle_name,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (row.patient_suffix) {
    parts.push(String(row.patient_suffix).trim());
  }

  return parts.join(", ");
}

function formatDateTime(value, timeValue = "") {
  if (!value) return "";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  const pad = (n) => String(n).padStart(2, "0");
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (timeValue) {
    const t = normalizeTimeValue(timeValue);
    if (t) return `${datePart} ${t}`;
  }

  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${datePart} ${hh}:${mm}:${ss}`;
}

function normalizeTimeValue(timeValue) {
  if (!timeValue) return "";

  if (timeValue instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(timeValue.getHours())}:${pad(timeValue.getMinutes())}:${pad(
      timeValue.getSeconds(),
    )}`;
  }

  const raw = String(timeValue).trim();
  if (!raw) return "";

  const hhmmssMatch = raw.match(/(\d{2}:\d{2}:\d{2})/);
  if (hhmmssMatch) return hhmmssMatch[1];

  return raw;
}

function mapPhicStatus(phicStatus) {
  if (!phicStatus) return "No PHIC";
  return String(phicStatus).trim();
}

function getRecordReceivedDetails(row) {
  const timestamp =
    formatDateTime(row.records_received_date, row.records_received_time);
  const remarks = String(row.records_received_remarks || "No Remarks").trim();

  return {
    timestamp,
    remarks,
    display: timestamp ? `${timestamp} - ${remarks}` : remarks,
  };
}

function mapVerifyStatus(verifyMark) {
  const value = String(verifyMark || "").trim().toUpperCase();
  if (!value) return "Not yet Verified";
  if (["Y", "1", "YES", "DONE", "VERIFIED"].includes(value)) {
    return "Verified";
  }
  return "Not yet Verified";
}

function mapScanStatus(row) {
  const mark = String(row.scan_mark || "").trim().toUpperCase();
  if (["Y", "1", "YES", "DONE", "SCANNED"].includes(mark)) {
    return "Scanned";
  }

  const hasScanTimestamp = Boolean(row.scan_date || row.scan_time);
  if (hasScanTimestamp) {
    return "Scanned";
  }

  return "Not yet Scanned";
}

function mapSendStatus(sendDate) {
  if (!sendDate) return "Not yet Sent";
  
  // Format the send date
  const formatted = formatDateTime(sendDate);
  return formatted ? `Sent (${formatted})` : "Not yet Sent";
}

function mapRecordFiled(scanDate, scanTime) {
  // Check if chart was filed by looking at hactrack timestamps
  if (!scanDate && !scanTime) {
    return "Not yet Filed";
  }
  
  // If has chart date/time, it means the chart was filed
  const formatted = formatDateTime(scanDate, scanTime);
  return formatted ? `Filed (${formatted})` : "Filed";
}

function mapClaimMapStatus(rawStatus) {
  const value = String(rawStatus || "").trim().toUpperCase();
  const submittedStatuses = ["SUBMITTED", "MAPPED", "FOR REVIEW"];

  if (!value) return "Not yet submitted to PhilHealth";
  if (submittedStatuses.includes(value)) return String(rawStatus).trim();
  return "Not yet submitted to PhilHealth";
}

function mapAcpn(acpn, claimNumber, claimMapStatus) {
  // Always return ACPN if it exists in the database
  if (acpn && String(acpn).trim()) {
    return String(acpn).trim();
  }

  // Fallback to claim number if no ACPN
  if (claimNumber && String(claimNumber).trim()) {
    return String(claimNumber).trim();
  }

  // Default if neither exists
  return "No cheque yet";
}

module.exports = {
  getChartTracking,
  getChartTrackingSummary,
};
