const { mapSex } = require("./dbHelpers");

const SUPPORTED_CHART_TRACKING_TYPES = ["ER", "OPD", "ADM"];

const CHART_TRACKING_TYPE_SQL = `
  CASE
    WHEN UPPER(COALESCE(hen.toecode, '')) LIKE '%ER%' OR UPPER(COALESCE(hen.toecode, '')) IN ('E') THEN 'ER'
    WHEN UPPER(COALESCE(hen.toecode, '')) IN ('OPD', 'OP', 'O') THEN 'OPD'
    WHEN UPPER(COALESCE(hen.toecode, '')) IN ('ADM', 'IPD', 'A', 'INP') THEN 'ADM'
    WHEN COALESCE(hadm.typadm, '') <> '' THEN 'ADM'
    WHEN COALESCE(hadm.admdate, '') <> '' OR COALESCE(hadm.disdate, '') <> '' THEN 'ADM'
    ELSE 'UNKNOWN'
  END
`;

function normalizeChartTrackingFilters(query = {}) {
  return {
    type: String(query.type || "").toUpperCase().trim(),
    hpercode: String(query.hpercode || "").trim(),
    enccode: String(query.enccode || "").trim(),
    search: String(query.search || "").trim(),
    dischargedDate: String(query.dischargedDate || "").trim(),
    admissionDateFrom: String(query.admissionDateFrom || "").trim(),
    admissionDateTo: String(query.admissionDateTo || "").trim(),
  };
}

function isSupportedChartTrackingType(type) {
  return !type || SUPPORTED_CHART_TRACKING_TYPES.includes(type);
}

function buildChartTrackingWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.type) {
    conditions.push(`${CHART_TRACKING_TYPE_SQL} = ?`);
    params.push(filters.type);
  }

  if (filters.hpercode) {
    conditions.push("hen.hpercode = ?");
    params.push(filters.hpercode);
  }

  if (filters.enccode) {
    conditions.push("hen.enccode = ?");
    params.push(filters.enccode);
  }

  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      "(hp.patlast LIKE ? OR hp.patfirst LIKE ? OR hp.hpercode LIKE ? OR hen.enccode LIKE ? OR hadm.pho_hospital_number LIKE ?)",
    );
    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    );
  }

  if (filters.dischargedDate) {
    conditions.push("DATE(hadm.disdate) = ?");
    params.push(filters.dischargedDate);
  }

  if (filters.admissionDateFrom) {
    conditions.push("DATE(hadm.admdate) >= ?");
    params.push(filters.admissionDateFrom);
  }

  if (filters.admissionDateTo) {
    conditions.push("DATE(hadm.admdate) <= ?");
    params.push(filters.admissionDateTo);
  }

  if (!filters.type) {
    conditions.push(`(${CHART_TRACKING_TYPE_SQL}) <> 'UNKNOWN'`);
  }

  return {
    conditions,
    params,
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function formatChartTrackingPatientName(row) {
  const parts = [row.patient_last_name, row.patient_first_name, row.patient_middle_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (row.patient_suffix) {
    parts.push(String(row.patient_suffix).trim());
  }

  return parts.join(", ");
}

function normalizeChartTrackingTimeValue(timeValue) {
  if (!timeValue) return "";

  if (timeValue instanceof Date) {
    const pad = (value) => String(value).padStart(2, "0");
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

function formatChartTrackingDateTime(value, timeValue = "") {
  if (!value) return "";

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return String(value);

  const pad = (number) => String(number).padStart(2, "0");
  const datePart = `${parsedDate.getFullYear()}-${pad(parsedDate.getMonth() + 1)}-${pad(
    parsedDate.getDate(),
  )}`;

  if (timeValue) {
    const normalizedTime = normalizeChartTrackingTimeValue(timeValue);
    if (normalizedTime) return `${datePart} ${normalizedTime}`;
  }

  const hours = pad(parsedDate.getHours());
  const minutes = pad(parsedDate.getMinutes());
  const seconds = pad(parsedDate.getSeconds());
  return `${datePart} ${hours}:${minutes}:${seconds}`;
}

function mapChartTrackingPhicStatus(phicStatus) {
  if (!phicStatus) return "No PHIC";
  return String(phicStatus).trim();
}

function getChartTrackingReceivedDetails(row) {
  const timestamp = formatChartTrackingDateTime(
    row.records_received_date,
    row.records_received_time,
  );
  const remarks = String(row.records_received_remarks || "No Remarks").trim();

  return {
    timestamp,
    remarks,
    display: timestamp ? `${timestamp} - ${remarks}` : remarks,
  };
}

function mapChartTrackingVerifyStatus(verifyMark) {
  const value = String(verifyMark || "").trim().toUpperCase();
  if (!value) return "Not yet Verified";
  if (["Y", "1", "YES", "DONE", "VERIFIED"].includes(value)) {
    return "Verified";
  }
  return "Not yet Verified";
}

function mapChartTrackingScanStatus(row) {
  const mark = String(row.scan_mark || "").trim().toUpperCase();
  if (["Y", "1", "YES", "DONE", "SCANNED"].includes(mark)) {
    return "Scanned";
  }

  if (row.scan_date || row.scan_time) {
    return "Scanned";
  }

  return "Not yet Scanned";
}

function mapChartTrackingSendStatus(sendDate) {
  if (!sendDate) return "Not yet Sent";

  const formatted = formatChartTrackingDateTime(sendDate);
  return formatted ? `Sent (${formatted})` : "Not yet Sent";
}

function mapChartTrackingFiledStatus(scanDate, scanTime) {
  if (!scanDate && !scanTime) {
    return "Not yet Filed";
  }

  const formatted = formatChartTrackingDateTime(scanDate, scanTime);
  return formatted ? `Filed (${formatted})` : "Filed";
}

function mapChartTrackingClaimMapStatus(rawStatus) {
  const value = String(rawStatus || "").trim().toUpperCase();
  const submittedStatuses = ["SUBMITTED", "MAPPED", "FOR REVIEW"];

  if (!value) return "Not yet submitted to PhilHealth";
  if (submittedStatuses.includes(value)) return String(rawStatus).trim();
  return "Not yet submitted to PhilHealth";
}

function mapChartTrackingAcpn(acpn, claimNumber) {
  if (acpn && String(acpn).trim()) {
    return String(acpn).trim();
  }

  if (claimNumber && String(claimNumber).trim()) {
    return String(claimNumber).trim();
  }

  return "No cheque yet";
}

function formatChartTrackingRecord(row) {
  const receivedDetails = getChartTrackingReceivedDetails(row);

  return {
    enccode: row.enccode || "",
    patient_id: row.patient_id || "",
    patient_name: formatChartTrackingPatientName(row),
    patient_sex: mapSex(row.patient_sex),
    hospital_no: row.hospital_no || "",
    encounter_type: row.encounter_type || "",
    discharged_date: formatChartTrackingDateTime(row.discharged_date, row.discharged_time),
    phic: mapChartTrackingPhicStatus(row.phic_status),
    records_received: receivedDetails.display,
    verify_status: mapChartTrackingVerifyStatus(row.verify_mark),
    scan_status: mapChartTrackingScanStatus(row),
    send_status: mapChartTrackingSendStatus(row.send_date),
    records_filed: mapChartTrackingFiledStatus(row.scan_date, row.scan_time),
    claim_map: mapChartTrackingClaimMapStatus(row.claim_map_status),
    acpn: mapChartTrackingAcpn(row.acpn, row.claim_number),
  };
}

function formatChartTrackingRecords(rows) {
  return rows.map((row) => formatChartTrackingRecord(row));
}

module.exports = {
  SUPPORTED_CHART_TRACKING_TYPES,
  CHART_TRACKING_TYPE_SQL,
  normalizeChartTrackingFilters,
  isSupportedChartTrackingType,
  buildChartTrackingWhereClause,
  formatChartTrackingPatientName,
  normalizeChartTrackingTimeValue,
  formatChartTrackingDateTime,
  mapChartTrackingPhicStatus,
  getChartTrackingReceivedDetails,
  mapChartTrackingVerifyStatus,
  mapChartTrackingScanStatus,
  mapChartTrackingSendStatus,
  mapChartTrackingFiledStatus,
  mapChartTrackingClaimMapStatus,
  mapChartTrackingAcpn,
  formatChartTrackingRecord,
  formatChartTrackingRecords,
};