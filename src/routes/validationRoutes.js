const express = require("express");
const {
  listHospitalForms,
  listValidations,
  getFormValidations,
  createFormValidatorMapping,
  createFormValidation,
  deleteFormValidation,
  runFormValidations,
  validateEncounter,
} = require("../controllers/validationController");

const router = express.Router();

// ===================== UNIVERSAL VALIDATION API =====================
// POST /api/validation/validate - Validate any encounter against any validations
// Body: { enccode, validationIds: [id1, id2, ...] }
router.post('/validate', validateEncounter);

// Single validation runner endpoint (form-specific)
// POST /api/validation/run { formId, enccode }
router.post('/run', runFormValidations);

// Admin endpoints for managing validation rules
router.get('/forms', listHospitalForms);
router.get('/validations', listValidations);
router.get('/form/:formId', getFormValidations);
router.post('/map', createFormValidatorMapping);
router.post('/form', createFormValidation);
router.delete('/form/:id', deleteFormValidation);

module.exports = router;
