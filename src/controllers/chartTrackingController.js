const pool = require("../config/db");
const {
  CHART_TRACKING_TYPE_SQL,
  chartTrackingTypeSql,
  buildChartTrackingWhereClause,
  formatChartTrackingRecords,
  isSupportedChartTrackingType,
  normalizeChartTrackingFilters,
} = require("../utils/chartTrackingHelpers");

// Encounter-type CASE evaluated against the paginated driving subquery (`page`),
// which exposes the needed henctr/hadmlog columns under a single alias.
const CHART_TRACKING_TYPE_SQL_PAGE = chartTrackingTypeSql("page", "page");

async function listChartTrackingRecords(req, res, next) {
  try {
    const filters = normalizeChartTrackingFilters(req.query);

    if (!isSupportedChartTrackingType(filters.type)) {
      return res.status(400).json({
        ok: false,
        message: "Type must be ER, OPD, or ADM",
      });
    }

    // Pagination params
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const { whereClause, params } = buildChartTrackingWhereClause(filters);

    // Deferred-join pagination: first resolve which encounters belong on this
    // page using only the tables the WHERE/ORDER touch (henctr + hperson + hadmlog),
    // then join the six 1:many detail tables for just those <=limit rows. The old
    // query fanned every detail join across the *entire* result set before the
    // LIMIT, which took 1.5-3 minutes; this returns the same rows in ~1s.
    const [rows] = await pool.query(
      `SELECT
         page.enccode,
         page.hpercode,
         COALESCE(page.pho_hospital_number, page.hpercode) AS hospital_no,
         hp.hpercode AS patient_id,
         hp.patlast AS patient_last_name,
         hp.patfirst AS patient_first_name,
         hp.patmiddle AS patient_middle_name,
         hp.patsuffix AS patient_suffix,
         hp.patsex AS patient_sex,
         page.admdate AS admission_date,
         MAX(CASE
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'ADM' THEN page.disdate
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'ER' THEN er.erdtedis
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'OPD' THEN opl.opddtedis
           ELSE COALESCE(page.disdate, er.erdtedis, opl.opddtedis)
         END) AS discharged_date,
         MAX(CASE
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'ADM' THEN page.distime
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'ER' THEN er.ertmedis
           WHEN ${CHART_TRACKING_TYPE_SQL_PAGE} = 'OPD' THEN opl.opdtmedis
           ELSE COALESCE(page.distime, er.ertmedis, opl.opdtmedis)
         END) AS discharged_time,
         ${CHART_TRACKING_TYPE_SQL_PAGE} AS encounter_type,
         page.encdate AS encounter_date,
         page.sort_date AS sort_date,
         page.encstat AS current_status,
         MAX(COALESCE(ph.phicstat, '')) AS phic_status,
         MAX(COALESCE(pcm.pClaimNumber, '')) AS claim_number,
         MAX(COALESCE(pcm.pStatus, '')) AS claim_map_status,
         MAX(COALESCE(pa.paacctno, '')) AS acpn,
         COALESCE(act.reqrecdte, act.chartdate, er.erdate, opl.opddate, page.disdate, page.admdate) AS records_received_date,
         COALESCE(act.reqrectme, act.charttime, er.ertime, opl.opdtime, page.distime, page.admtime) AS records_received_time,
         COALESCE(act.hremarks, er.ernotes, opl.opdrem, '') AS records_received_remarks,
         MAX(COALESCE(er.erstat, opl.opdstat, '')) AS verify_mark,
         MAX(COALESCE(act.ccsmark, '')) AS scan_mark,
         act.chartdate AS scan_date,
         act.charttime AS scan_time,
         COALESCE(act.billdate, er.erdate, opl.opddate, page.admdate) AS send_date,
         page.disdate AS bill_date,
         page.distime AS bill_time
       FROM (
         SELECT
           hen.enccode,
           hen.hpercode,
           hen.toecode,
           hen.encdate,
           hen.encstat,
           hadm.admdate,
           hadm.admtime,
           hadm.disdate,
           hadm.distime,
           hadm.typadm,
           hadm.pho_hospital_number,
           COALESCE(hadm.disdate, hadm.admdate, hen.encdate) AS sort_date
         FROM henctr hen
         INNER JOIN hperson hp ON hp.hpercode = hen.hpercode
         LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
         LEFT JOIN herlog er ON er.enccode = hen.enccode
         LEFT JOIN hopdlog opl ON opl.enccode = hen.enccode
         ${whereClause}
         GROUP BY hen.enccode, hen.hpercode, hen.toecode, hen.encdate, hen.encstat,
                  hadm.admdate, hadm.admtime, hadm.disdate, hadm.distime, hadm.typadm,
                  hadm.pho_hospital_number
         ORDER BY sort_date ASC, hen.encdate ASC
         LIMIT ? OFFSET ?
       ) AS page
       INNER JOIN hperson hp ON hp.hpercode = page.hpercode
       LEFT JOIN herlog er ON er.enccode = page.enccode
       LEFT JOIN hopdlog opl ON opl.enccode = page.enccode
       LEFT JOIN hactrack act ON act.enccode = page.enccode
       LEFT JOIN hphiclaim ph ON ph.enccode = page.enccode
       LEFT JOIN hphicclaimmap pcm ON pcm.enccode = page.enccode
       LEFT JOIN hpatacct pa ON pa.enccode = page.enccode
       GROUP BY page.enccode, page.hpercode, hp.hpercode, hp.patlast, hp.patfirst,
                hp.patmiddle, hp.patsuffix, hp.patsex, page.admdate, page.disdate,
                page.distime, page.pho_hospital_number, page.toecode, page.typadm,
                page.encdate, page.encstat, page.sort_date
       ORDER BY page.sort_date ASC, page.encdate ASC`,
      [...params, limit, offset],
    );

    // Total count for pagination. The six detail joins never add or remove an
    // enccode (they only fan rows out), so COUNT(DISTINCT enccode) is identical
    // with just the WHERE-relevant tables — and ~80x cheaper.
    const [countResult] = await pool.query(
      `SELECT COUNT(DISTINCT hen.enccode) AS total
       FROM henctr hen
       INNER JOIN hperson hp ON hp.hpercode = hen.hpercode
       LEFT JOIN hadmlog hadm ON hadm.enccode = hen.enccode
       LEFT JOIN herlog er ON er.enccode = hen.enccode
       LEFT JOIN hopdlog opl ON opl.enccode = hen.enccode
       ${whereClause}`,
      params,
    );
    const total = countResult[0]?.total || 0;

    return res.json({
      ok: true,
      data: formatChartTrackingRecords(rows),
      count: rows.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
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
       LEFT JOIN herlog er ON er.enccode = hen.enccode
       LEFT JOIN hopdlog opl ON opl.enccode = hen.enccode
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
