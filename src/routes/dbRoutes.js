const express = require("express");

// Health & Status endpoints
const { dbStatus, listTables, dbInfo } = require("../controllers/healthController");

// Patient endpoints
const {
  getPatientList,
  getPatientHistory,
  searchPatients,
} = require("../controllers/patientController");

// Encounter endpoints
const {
  getHenctrInfo,
  getPatientEncounterRecords,
} = require("../controllers/encounterController");

// Form endpoints
const { getBabyForm } = require("../controllers/formController");

const router = express.Router();

// Health & Status routes
router.get("/status", dbStatus);
router.get("/tables", listTables);
router.get("/info", dbInfo);

// Encounter routes
router.get("/henctr", getHenctrInfo);

// Patient routes
router.get("/patients", searchPatients);
router.get("/patients/history/:hpercode", getPatientHistory);

// Patient Encounter routes
router.get(
  "/patients/:hpercode/encounters/:enccode/records",
  getPatientEncounterRecords,
);

// Form routes
router.get("/forms/baby", getBabyForm);

module.exports = router;
