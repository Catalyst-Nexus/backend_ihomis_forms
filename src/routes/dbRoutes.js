const express = require("express");

// Health & Status endpoints
const {
  dbStatus,
  listTables,
  dbInfo,
} = require("../controllers/healthController");

// Patient endpoints
const {
  getPatientList,
  getPatientHistory,
  searchPatients,
} = require("../controllers/patientController");

// Encounter endpoints
const {
  getHenctrInfo,
  getLatestEncounterForPatient,
  getPatientEncounterRecords,
  getEncountersForPatient,
} = require("../controllers/encounterController");

// Lab Upload endpoints
const {
  getOrdersForEncounter,
  debugSchema,
  debugSampleData,
} = require("../controllers/labUploadController");

// Form endpoints
const {
  listBabyFormRecords,
  validateFormRecords,
} = require("../controllers/formController");

// Chart Tracking endpoints
const {
  listChartTrackingRecords,
  getChartTrackingSummary,
} = require("../controllers/chartTrackingController");

// User endpoints
const {
  getUsers,
  getUserById,
  searchUserByEmployeeId,
  verifyPassword,
} = require("../controllers/userController");

const router = express.Router();

// Health & Status routes
router.get("/status", dbStatus);
router.get("/tables", listTables);
router.get("/info", dbInfo);

// Debug route - check actual table schemas
router.get("/debug/schema", debugSchema);

// Debug route - check sample orcode/proccode values
router.get("/debug/sample-data", debugSampleData);

// Encounter routes
router.get("/henctr", getHenctrInfo);
router.get(
  "/patients/:hpercode/encounters/latest",
  getLatestEncounterForPatient,
);

// Patient routes
router.get("/patients", searchPatients);
router.get("/patients/history/:hpercode", getPatientHistory);

// Patient Encounter routes
router.get(
  "/patients/:hpercode/encounters/:enccode/records",
  getPatientEncounterRecords,
);

// Lab upload flow - patient encounters list (for modal selection)
// NOTE: This route MUST come before /patients/history/:hpercode to avoid route conflict
router.get("/patients/:hpercode/encounters", getEncountersForPatient);

// Form routes
router.get("/forms/baby", listBabyFormRecords);
router.get("/forms/validation", validateFormRecords);

// Chart Tracking routes
router.get("/chart-tracking", listChartTrackingRecords);
router.get("/chart-tracking/summary", getChartTrackingSummary);

// User routes
router.get("/users", getUsers);
router.post("/users/verify-password", verifyPassword);
router.get("/users/by-employee/:employeeId", searchUserByEmployeeId);
router.get("/users/:userId", getUserById);

// ============================================================
// Lab Upload Workflow Routes
// Patient → Encounter → Order (hdocord) → Upload → Finalize
//
// Note: hdocord IS the order table - no separate procedures fetch needed.
// ============================================================

// GET /api/db/encounters/:enccode/orders
// Fetch lab/radiology orders for an encounter (from hdocord)
router.get("/encounters/:enccode/orders", getOrdersForEncounter);

module.exports = router;
