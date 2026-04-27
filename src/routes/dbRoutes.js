const express = require("express");
const {
  dbStatus,
  listTables,
  dbInfo,
  getHenctrInfo,
  searchPatients,
  getPatientList,
  getPatientHistory,
  getPatientEncounterRecords,
  getBabyForm,
} = require("../controllers/dbController");

const router = express.Router();

router.get("/status", dbStatus);
router.get("/tables", listTables);
router.get("/info", dbInfo);
router.get("/henctr", getHenctrInfo);
router.get("/patients", searchPatients);
router.get("/patients/history/:hpercode", getPatientHistory);
router.get(
  "/patients/:hpercode/encounters/:enccode/records",
  getPatientEncounterRecords,
);
router.get("/forms/baby", getBabyForm);

module.exports = router;
