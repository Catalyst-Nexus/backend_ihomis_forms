const express = require("express");
const multer = require("multer");

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
  getProceduresForOrder,
  registerLabResultUpload,
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
} = require("../controllers/userController");

const router = express.Router();

// Multer configuration for lab result uploads (multipart/form-data)
const labUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("application/")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

// Health & Status routes
router.get("/status", dbStatus);
router.get("/tables", listTables);
router.get("/info", dbInfo);

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
router.get("/patients/:hpercode/encounters", getEncountersForPatient);

// Form routes
router.get("/forms/baby", listBabyFormRecords);
router.get("/forms/validation", validateFormRecords);

// Chart Tracking routes
router.get("/chart-tracking", listChartTrackingRecords);
router.get("/chart-tracking/summary", getChartTrackingSummary);

// User routes
router.get("/users", getUsers);
router.get("/users/by-employee/:employeeId", searchUserByEmployeeId);
router.get("/users/:userId", getUserById);

// ============================================================
// Lab Upload Workflow Routes
// Patient → Encounter → Order → Procedure → Upload → Finalize
// ============================================================

// GET /api/db/encounters/:enccode/orders
// Fetch lab/radiology orders for an encounter
router.get("/encounters/:enccode/orders", getOrdersForEncounter);

// GET /api/db/encounters/:enccode/orders/:orcode/procedures
// Fetch procedures (line items) for a specific order
router.get(
  "/encounters/:enccode/orders/:orcode/procedures",
  getProceduresForOrder,
);

// POST /api/db/lab-results
// Upload a lab result PDF:
//   1. Validate patient + encounter exist in MySQL
//   2. Upload PDF to Supabase storage
//   3. Insert metadata into lab_result_uploads table
//   4. Return docointkey for tracking
router.post(
  "/lab-results",
  labUploadMulter.single("file"),
  registerLabResultUpload,
);

module.exports = router;
