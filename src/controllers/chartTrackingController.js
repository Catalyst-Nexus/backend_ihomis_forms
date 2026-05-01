const pool = require("../config/db");
const {
  CHART_TRACKING_TYPE_SQL,
  buildChartTrackingWhereClause,
  formatChartTrackingRecords,
  isSupportedChartTrackingType,
  normalizeChartTrackingFilters,
} = require("../utils/chartTrackingHelpers");

async function listChartTrackingRecords(req, res, next) {
  try {
    const filters = normalizeChartTrackingFilters(req.query);

    if (!isSupportedChartTrackingType(filters.type)) {
      return res.status(400).json({
        ok: false,
        message: "Type must be ER, OPD, or ADM",
      });
    }

    const { whereClause, params } = buildChartTrackingWhereClause(filters);

    const [rows] = await pool.query(
      `SELECT
         hen.enccode,
         hen.hpercode,
         COALESCE(hadm.pho_hospital_number, hen.hpercode) AS hospital_no,
         hp.hpercode AS patient_id,
         hp.patlast AS patient_last_name,
         hp.patfirst AS patient_first_name,
         hp.patmiddle AS patient_middle_name,
         hp.patsuffix AS patient_suffix,
         hp.patsex AS patient_sex,
         hadm.admdate AS admission_date,
         MAX(CASE
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'ADM' THEN hadm.disdate
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'ER' THEN er.erdtedis
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'OPD' THEN opl.opddtedis
           ELSE COALESCE(hadm.disdate, er.erdtedis, opl.opddtedis)
         END) AS discharged_date,
         MAX(CASE
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'ADM' THEN hadm.distime
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'ER' THEN er.ertmedis
           WHEN ${CHART_TRACKING_TYPE_SQL} = 'OPD' THEN opl.opdtmedis
           ELSE COALESCE(hadm.distime, er.ertmedis, opl.opdtmedis)
         END) AS discharged_time,
         ${CHART_TRACKING_TYPE_SQL} AS encounter_type,
         hen.encdate AS encounter_date,
         COALESCE(hadm.disdate, hadm.admdate, hen.encdate) AS sort_date,
         hen.encstat AS current_status,
         MAX(COALESCE(ph.phicstat, '')) AS phic_status,
         MAX(COALESCE(pcm.pClaimNumber, '')) AS claim_number,
         MAX(COALESCE(pcm.pStatus, '')) AS claim_map_status,
         MAX(COALESCE(pa.paacctno, '')) AS acpn,
         COALESCE(act.reqrecdte, act.chartdate, er.erdate, opl.opddate, hadm.disdate, hadm.admdate) AS records_received_date,
         COALESCE(act.reqrectme, act.charttime, er.ertime, opl.opdtime, hadm.distime, hadm.admtime) AS records_received_time,
         COALESCE(act.hremarks, er.ernotes, opl.opdrem, '') AS records_received_remarks,
         MAX(COALESCE(er.erstat, opl.opdstat, '')) AS verify_mark,
         MAX(COALESCE(act.ccsmark, '')) AS scan_mark,
         act.chartdate AS scan_date,
         act.charttime AS scan_time,
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
                hadm.distime, hadm.pho_hospital_number, hen.toecode, hadm.typadm,
                hen.encdate, hen.encstat
       ORDER BY sort_date DESC, hen.encdate DESC`,
      params,
    );

    return res.json({
      ok: true,
      data: formatChartTrackingRecords(rows),
      count: rows.length,
      filters: {
        type: filters.type || "All",
        hpercode: filters.hpercode || null,
        enccode: filters.enccode || null,
        search: filters.search || null,
        dischargedDate: filters.dischargedDate || null,
        admissionDateFrom: filters.admissionDateFrom || null,
        admissionDateTo: filters.admissionDateTo || null,
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

async function getChartTrackingSummary(req, res, next) {
  try {
    const filters = normalizeChartTrackingFilters(req.query);

    if (!isSupportedChartTrackingType(filters.type)) {
      return res.status(400).json({
        ok: false,
        message: "Type must be ER, OPD, or ADM",
      });
    }

    const { whereClause, params } = buildChartTrackingWhereClause({ type: filters.type });

    const [stats] = await pool.query(
      `SELECT
         ${CHART_TRACKING_TYPE_SQL} AS encounter_type,
         COUNT(DISTINCT hen.enccode) AS total_encounters,
         COUNT(DISTINCT CASE
           WHEN COALESCE(hadm.disdate, '') <> '' THEN hen.enccode
         END) AS discharged
       FROM henctr hen
       LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
       ${whereClause}
       GROUP BY encounter_type`,
      params,
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

module.exports = {
  listChartTrackingRecords,
  getChartTrackingRecords: listChartTrackingRecords,
  getChartTracking: listChartTrackingRecords,
  getChartTrackingSummary,
};
