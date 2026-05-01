const pool = require("../config/db");

// ==================== Regex & Constants ====================
const DISCHARGE_REGEX = /disch(?:arge)?/i;

const RECORD_CONFIGS = [
  { key: "other_details", table: "hvsothr" },
  { key: "vital_signs", table: "hvitalsign", single: true },
  { key: "medical_history", table: "hmrhisto" },
  { key: "signs_and_symptoms", table: "hsignsymptoms" },
  { key: "symptom_physical_others", table: "hpesignsothers" },
  { key: "physical_exam", table: "hphyexam" },
  { key: "system_review", table: "hmrsrev" },
  { key: "ward_course", table: "hcrsward" },
  { key: "diagnoses", table: "hencdiag" },
  { key: "doctor_orders_medication", table: "hrxo" },
  { key: "medical_supplies", table: "hrqd" },
  {
    key: "doctor_orders_exams",
    table: "hdocord",
    sql: "SELECT * FROM hdocord WHERE enccode = ? AND estatus = 'S'",
  },
];

const CHRONOLOGICAL_TABLE_KEYS = new Set([
  "ward_course",
  "doctor_orders_medication",
  "medical_supplies",
  "doctor_orders_exams",
]);

// ==================== String & Formatting Helpers ====================
function escapeIdentifier(identifier) {
  return String(identifier).replace(/`/g, "``");
}

function mapSex(sexCode) {
  if (!sexCode) return "";
  const code = String(sexCode).toUpperCase();
  if (code === "M" || code === "MALE" || code === "1") return "male";
  if (code === "F" || code === "FEMALE" || code === "2") return "female";
  return "unknown";
}

function formatDate(date) {
  if (!date) return "";
  try {
    const parsed = new Date(date);
    return parsed.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function buildFullName(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

// ==================== Date & Age Helpers ====================
function calculateAgeFromDate(date) {
  if (!date) {
    return {
      days: null,
      display: "",
    };
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return {
      days: null,
      display: "",
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = Math.max(0, Date.now() - parsed.getTime());
  const totalDays = Math.floor(diffMs / msPerDay);

  if (totalDays < 31) {
    return { days: totalDays, display: `${totalDays} day(s)` };
  }

  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30);
    return { days: totalDays, display: `${months} month(s)` };
  }

  const years = Math.floor(totalDays / 365);
  return { days: totalDays, display: `${years} year(s)` };
}

function toTimestamp(value, time) {
  if (!value && !time) {
    return null;
  }

  const combined = [value, time].filter(Boolean).join(" ");
  const parsed = new Date(combined);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

  return null;
}

// ==================== Array & Data Sorting Helpers ====================
function findMatchingKey(keys, matcher) {
  return keys.find((key) => matcher(key.toLowerCase()));
}

function sortRowsByDateTime(rows) {
  if (!rows?.length) {
    return rows;
  }

  const keys = Object.keys(rows[0]);
  const dateKey = findMatchingKey(keys, (name) => name.includes("date"));
  if (!dateKey) {
    return rows;
  }

  const timeKey = findMatchingKey(keys, (name) => name.includes("time"));

  return [...rows].sort((a, b) => {
    const aTs = toTimestamp(a[dateKey], timeKey ? a[timeKey] : null);
    const bTs = toTimestamp(b[dateKey], timeKey ? b[timeKey] : null);

    if (aTs === null && bTs === null) {
      return 0;
    }
    if (aTs === null) {
      return 1;
    }
    if (bTs === null) {
      return -1;
    }

    return aTs - bTs;
  });
}

function filterDischargeOrders(rows) {
  if (!rows?.length) {
    return rows;
  }

  const keys = Object.keys(rows[0]);
  const descriptionKey = findMatchingKey(keys, (name) => name.includes("desc"));
  if (!descriptionKey) {
    return rows;
  }

  return rows.filter(
    (row) => !DISCHARGE_REGEX.test(String(row[descriptionKey] ?? "").trim()),
  );
}

// ==================== Record Bucket Helpers ====================
function createEmptyRecordBucket() {
  return RECORD_CONFIGS.reduce((bucket, config) => {
    bucket[config.key] = config.single ? null : [];
    return bucket;
  }, {});
}

// ==================== Row Mapping Functions ====================
function mapPatientRow(row) {
  return {
    ...row,
    id: row.hpercode || row.hospital_number || "",
    hpercode: row.hpercode || row.hospital_number || "",
    first_name: row.first_name || row.patfirst || "",
    middle_name: row.middle_name || row.patmiddle || "",
    last_name: row.last_name || row.patlast || "",
    patient_name: row.patient_name || row.full_name || "",
    ext_name: row.ext_name || row.patsuffix || row.suffix || "",
    sex: mapSex(row.sex || row.patsex),
    birth_date: formatDate(row.birth_date || row.patbdate),
    birth_place: row.birth_place || row.patbplace || "",
    civil_status_code: row.civil_status || row.patcstat || "",
    nationality_code: row.nationality || row.natcode || "",
    religion_code: row.religion || row.relcode || "",
    contact_number: row.telephone_number || row.pattelno || "",
    father_last_name: row.father_last_name || row.fatlast || "",
    father_middle_name: row.father_middle_name || row.fatmid || "",
    father_first_name: row.father_first_name || row.fatfirst || "",
    fathers_name: row.fathers_name || "",
    mother_last_name: row.mother_last_name || row.motlast || "",
    mother_first_name: row.mother_first_name || row.motfirst || "",
    mother_middle_name: row.mother_middle_name || row.motmid || "",
    mothers_name: row.mothers_name || "",
    employment_status: row.employment_status || row.patempstat || "",
    facility_code: row.facility_code || row.hfhudcode || "",
    facility_name: row.facility_name || "",
    created_at: row.created_at || "",
    brgy: row.bgycode || row.brgy || "",
    brgy_name: row.bgyname || row.barangay_name || "",
    street: row.street || row.patstr || "",
    city_code: row.city_code || row.ctycode || "",
    city_name: row.city_name || row.ctyname || "",
    province_code: row.province_code || row.provcode || "",
    province_name: row.province_name || row.provname || "",
    region_name: row.region_name || row.regname || "",
    zip_code: row.zip_code || row.patzip || "",
    patient_address: row.patient_address || "",
    case_number: row.case_number || row.casenum || "",
    age: row.age || row.patage || "",
    admission_date: formatDate(row.admission_date || row.admdate),
    discharge_date: formatDate(row.discharge_date || row.disdate),
    requesting_physician: row.requesting_physician || "",
    health_number: row.health_number || "",
    room_name: row.room_name || row.rmname || "",
    bed_name: row.bed_name || row.bdname || "",
    ward_name: row.ward_name || row.wardname || "",
    room_number: row.room_number || "",
    blood_pressure: row.blood_pressure || row.vsbp || "",
    temperature: row.temperature || row.vstemp || "",
    pulse: row.pulse || row.vspulse || "",
    resp: row.resp || row.vsresp || "",
    o2sats: row.o2sats || "",
    weight: row.weight || row.vsweight || "",
    height: row.height || row.vsheight || "",
    bmi: row.bmi || row.vsbmi || "",
    bmi_category: row.bmi_category || row.vsbmicat || "",
    ward_category: row.ward_category || row.tsdesc || "",
    discharge_diagnosis: row.discharge_diagnosis || row.disnotes || "",
    disposition: row.disposition || row.dispcode || "",
    condition: row.condition || row.condcode || "",
    type_of_admission: row.type_of_admission || row.newold || "",
    fetal_heart_rate: row.fetal_heart_rate || row.fetalhr || "",
    admitting_clerk: row.admitting_clerk || "",
  };
}

function mapBabyFormRow(row) {
  const babyAge = calculateAgeFromDate(row.baby_birth_date);

  const babyName = buildFullName(
    row.baby_first_name,
    row.baby_middle_name,
    row.baby_last_name,
  );

  const motherName = buildFullName(
    row.mother_first_name,
    row.mother_middle_name,
    row.mother_last_name,
    row.mother_suffix,
  );

  const completeAddress = [
    row.address_street,
    row.address_barangay,
    row.address_city,
    row.address_province,
    row.address_region,
    row.address_zip,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");

  return {
    enccode: row.enccode || "",
    baby_hpercode: row.baby_hpercode || "",
    mother_hpercode: row.mother_hpercode || "",
    baby_name: babyName,
    baby_sex: mapSex(row.baby_sex_code),
    baby_birth_date: formatDate(row.baby_birth_date),
    baby_age: babyAge.display,
    baby_age_days: babyAge.days,
    mother_name: motherName,
    mother_sex: mapSex(row.mother_sex_code),
    hospital_no: row.hospital_number || "",
    complete_address: completeAddress,
    type_of_delivery: row.delivery_type || "",
    obstetrician: row.obstetrician_name || row.obstetrician_license_no || "",
    obstetrician_license_no: row.obstetrician_license_no || "",
    anesthesia: row.anesthesia_type || "",
    anesthesiologist:
      row.anesthesiologist_name || row.anesthesiologist_license_no || "",
    anesthesiologist_license_no: row.anesthesiologist_license_no || "",
    source_tables: {
      baby: "hnewborn",
      mother: "henctr + hperson",
      hospital_no: "COALESCE(hadmlog.pho_hospital_number, henctr.hpercode)",
      address: "haddr + hbrgy + hcity + hprov + hregion",
      delivery: "hdelivery",
      obstetrician: "hpostpartum + hprovider + hpersonal",
      anesthesia: "hproclog + hprovider + hpersonal",
    },
  };
}

// ==================== Encounter Records Fetcher ====================
async function fetchEncounterRecords(enccode) {
  const records = createEmptyRecordBucket();
  const warnings = [];

  for (const config of RECORD_CONFIGS) {
    const sql = config.sql ?? `SELECT * FROM ${config.table} WHERE enccode = ?`;
    try {
      const [rows] = await pool.query(sql, [enccode]);
      records[config.key] = config.single ? (rows[0] ?? null) : rows;
    } catch (error) {
      warnings.push({ table: config.table, message: error.message });
      records[config.key] = config.single ? null : [];
      console.warn(
        `Encounter records query failed for ${config.table}:`,
        error.message,
      );
    }
  }

  if (Array.isArray(records.doctor_orders_exams)) {
    records.doctor_orders_exams = filterDischargeOrders(
      records.doctor_orders_exams,
    );
  }

  CHRONOLOGICAL_TABLE_KEYS.forEach((key) => {
    if (Array.isArray(records[key])) {
      records[key] = sortRowsByDateTime(records[key]);
    }
  });

  return { records, warnings };
}

module.exports = {
  // Constants
  DISCHARGE_REGEX,
  RECORD_CONFIGS,
  CHRONOLOGICAL_TABLE_KEYS,

  // String helpers
  escapeIdentifier,
  mapSex,
  formatDate,
  buildFullName,

  // Date helpers
  calculateAgeFromDate,
  toTimestamp,

  // Array helpers
  findMatchingKey,
  sortRowsByDateTime,
  filterDischargeOrders,

  // Record bucket
  createEmptyRecordBucket,

  // Row mappers
  mapPatientRow,
  mapBabyFormRow,

  // Encounter records
  fetchEncounterRecords,
};
