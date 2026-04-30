/**
 * Legacy dbController index file
 * This file aggregates all controller exports for backward compatibility
 * 
 * For new code, import specific controllers directly:
 * - healthController.js: Database health & status endpoints
 * - patientController.js: Patient listing, history, and search endpoints
 * - encounterController.js: Encounter information and records endpoints
 * - formController.js: Form-specific endpoints (baby form, etc.)
 */

const healthController = require("./healthController");
const patientController = require("./patientController");
const encounterController = require("./encounterController");
const formController = require("./formController");
const chartTrackingController = require("./chartTrackingController");

module.exports = {
  // Health & Status
  ...healthController,

  // Patient
  ...patientController,

  // Encounter
  ...encounterController,

  // Forms
  ...formController,

  // Chart Tracking
  ...chartTrackingController,
};
