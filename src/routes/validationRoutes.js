const express = require("express");
const {
  listHospitalForms,
  listValidations,
  getFormValidations,
  createFormValidatorMapping,
  createFormValidation,
  deleteFormValidation,
  runFormValidations,
} = require("../controllers/validationController");

const router = express.Router();

// Single validation runner endpoint (main API)
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
