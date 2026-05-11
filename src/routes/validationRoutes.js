const express = require("express");
const {
  validateAdmission,
  validateDischarge,
  getValidationDetails,
  checkHistory,
  validatePhic,
  // new handlers
  listHospitalForms,
  listValidations,
  getFormValidations,
  createFormValidatorMapping,
  createFormValidation,
  deleteFormValidation,
  runFormValidations,
} = require("../controllers/validationController");

const router = express.Router();

// Only keep the Supabase-backed validation admin API
// POST /api/validation/run { formId, enccode }
router.post('/run', runFormValidations);

// Lookup lists for admin UI
router.get('/forms', listHospitalForms);
router.get('/validations', listValidations);

// Manage validation definitions (stored in Supabase)
router.get('/form/:formId', getFormValidations);
router.post('/map', createFormValidatorMapping);
router.post('/form', createFormValidation);
router.delete('/form/:id', deleteFormValidation);

module.exports = router;
