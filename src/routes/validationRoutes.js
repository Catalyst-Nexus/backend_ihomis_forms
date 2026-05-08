const express = require("express");
const {
  validateAdmission,
  validateDischarge,
  getValidationDetails,
  checkHistory,
  validatePhic,
} = require("../controllers/validationController");

const router = express.Router();

/**
 * GET /api/validation/admission/:enccode
 * Validate complete admission form for an encounter
 */
router.get("/admission/:enccode", validateAdmission);

/**
 * GET /api/validation/discharge/:enccode
 * Validate complete discharge form for an encounter
 */
router.get("/discharge/:enccode", validateDischarge);

/**
 * GET /api/validation/details/:enccode
 * Get detailed validation results for all form components
 */
router.get("/details/:enccode", getValidationDetails);

/**
 * GET /api/validation/history/:enccode/:histype
 * Check if a specific history type exists for an encounter
 * History types: GDPPR, COMPL, PRHIS, PAHIS, OCENV, FAHIS, DRTHE, ALCOH, TOBAC, DRUGA, OTHAL
 */
router.get("/history/:enccode/:histype", checkHistory);

/**
 * GET /api/validation/phic/:enccode
 * Check PHIC status for an encounter
 */
router.get("/phic/:enccode", validatePhic);

module.exports = router;
