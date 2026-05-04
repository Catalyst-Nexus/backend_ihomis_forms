# Database Controller Structure

This document describes the refactored controller structure for the ihomis-forms backend API.

## Overview

The monolithic `dbController.js` has been split into focused, endpoint-specific controller files for better organization and easier debugging. All helper functions and utilities have been extracted into a shared utilities module.

## File Structure

```
src/
├── controllers/
│   ├── dbController.js           (Index file - re-exports all controllers for backward compatibility)
│   ├── healthController.js       (Health & status checks)
│   ├── patientController.js      (Patient endpoints)
│   ├── encounterController.js    (Encounter endpoints)
│   ├── formController.js         (Form endpoints)
│   └── chartTrackingController.js (CHART Tracking System endpoints)
├── utils/
│   └── dbHelpers.js              (Shared helper functions & utilities)
└── routes/
    └── dbRoutes.js               (Routes using the new controllers)
```

## Controllers

### Health Controller
**File:** `src/controllers/healthController.js`

Handles database health checks and system information:
- `dbStatus()` - GET `/api/db/status` - Check database connection
- `listTables()` - GET `/api/db/tables` - List all database tables
- `dbInfo()` - GET `/api/db/info` - Get database info and facility code

### Patient Controller
**File:** `src/controllers/patientController.js`

Manages patient-related endpoints:
- `getPatientList()` - GET `/api/db/patients` - List patients with filters
- `getPatientHistory()` - GET `/api/db/patients/history/:hpercode` - Get patient admission/discharge history
- `searchPatients()` - GET `/api/db/patients` (with search/q params) - Global patient search

### Encounter Controller
**File:** `src/controllers/encounterController.js`

Handles encounter and medical records:
- `getHenctrInfo()` - GET `/api/db/henctr` - Get encounter information
- `getPatientEncounterRecords()` - GET `/api/db/patients/:hpercode/encounters/:enccode/records` - Get all encounter records

### Form Controller
**File:** `src/controllers/formController.js`

Manages medical form endpoints:
- `listBabyFormRecords()` - GET `/api/db/forms/baby` - Get newborn/baby form information
- `validateFormRecords()` - GET `/api/db/forms/validation` - Validate whether requested forms already exist for a patient/encounter

### Chart Tracking Controller
**File:** `src/controllers/chartTrackingController.js`

Manages CHART Tracking System endpoints:
- `listChartTrackingRecords()` - GET `/api/db/chart-tracking` - Get chart tracking data with ER/OPD/ADM filtering
- `getChartTrackingSummary()` - GET `/api/db/chart-tracking/summary` - Get summary statistics by encounter type

## Utilities

### DB Helpers
**File:** `src/utils/dbHelpers.js`

Centralized helper functions and utilities:

**Constants:**
- `DISCHARGE_REGEX` - Regex for discharge order filtering
- `RECORD_CONFIGS` - Encounter record table configurations
- `CHRONOLOGICAL_TABLE_KEYS` - Tables requiring chronological sorting

**String Helpers:**
- `escapeIdentifier()` - Escape SQL identifiers
- `mapSex()` - Convert sex codes to readable format
- `formatDate()` - Format dates to ISO format
- `buildFullName()` - Concatenate name parts

**Date Helpers:**
- `calculateAgeFromDate()` - Calculate age from birth date
- `toTimestamp()` - Convert date/time to timestamp

**Array Helpers:**
- `findMatchingKey()` - Find key by matcher function
- `sortRowsByDateTime()` - Sort rows by date/time columns
- `filterDischargeOrders()` - Filter out discharge orders

**Record Helpers:**
- `createEmptyRecordBucket()` - Initialize record bucket
- `mapPatientRow()` - Transform patient row to API format
- `mapBabyFormRow()` - Transform baby form row to API format
- `fetchEncounterRecords()` - Fetch all encounter records

## Usage

### Direct Controller Import
For new code, import specific controllers:

```javascript
// Import health controller
const { dbStatus, listTables } = require("../controllers/healthController");

// Import patient controller
const { getPatientList, searchPatients } = require("../controllers/patientController");

// Import encounter controller
const { getHenctrInfo } = require("../controllers/encounterController");

// Import forms controller
const { listBabyFormRecords } = require("../controllers/formController");
```

### Using Helpers
```javascript
const {
  mapPatientRow,
  mapBabyFormRow,
  fetchEncounterRecords,
  formatDate,
  mapSex
} = require("../utils/dbHelpers");
```

### Legacy Compatibility
The original `dbController.js` still exports all functions for backward compatibility:

```javascript
const { dbStatus, getPatientList, getBabyForm } = require("../controllers/dbController");
```

## Benefits

1. **Easier Debugging** - Locate endpoint code faster
2. **Better Maintainability** - Each controller handles one domain
3. **Code Reusability** - Shared utilities prevent duplication
4. **Scalability** - Easy to add new controllers for new features
5. **Clear Separation** - Distinct responsibilities per file
6. **Backward Compatible** - Existing imports still work

## Migration Guide

If you have existing code importing from `dbController.js`:

**Before:**
```javascript
const { getPatientList, dbStatus } = require("../controllers/dbController");
```

**After (Recommended):**
```javascript
const { getPatientList } = require("../controllers/patientController");
const { dbStatus } = require("../controllers/healthController");
```

Or keep using the legacy import - it still works!

## Adding New Endpoints

1. Create a new controller file in `src/controllers/`
2. Add your functions following the existing pattern
3. Export functions from the new controller
4. Update `src/routes/dbRoutes.js` to import and use the new functions
5. Optionally update `src/controllers/dbController.js` to re-export for backward compatibility

## Testing

There are no automated tests configured yet. The `npm test` script is currently a placeholder and will print `No tests configured`.

For now, validate controller changes by running the app and exercising the endpoints manually:

```bash
npm run dev
```

Then test the relevant route with Postman, curl, or your frontend client.

If you add a test runner later, keep the tests close to the controller you are validating.

