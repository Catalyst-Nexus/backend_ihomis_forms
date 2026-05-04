# iHOMIS Forms Backend

Express.js backend for iHOMIS Forms with MySQL connection via environment variables.

## Prerequisites

- Node.js 18+
- npm

## Setup

1. Install dependencies:
   `npm install`
2. Create environment file:
   Copy `.env.example` to `.env` and update values.
3. Start development server:
   `npm run dev`

## Available Scripts

- `npm run dev` - Start server with nodemon
- `npm start` - Start server in production mode

## API Endpoints

- `GET /` - API info
- `GET /api/health` - Service health
- `GET /api/db/status` - MySQL connection check
- `GET /api/db/tables` - List database tables
- `GET /api/db/info` - Database name and facility code discovery info
- `GET /api/db/henctr` - Fetch connected `hdocord` + `henctr` rows with `enccode`, `fhud`, and `docointkey`
- `GET /api/db/henctr` - Fetch `enccode` and `fhud` from `henctr`
- `GET /api/db/patients` - Fetch paginated patient list with optional filters
- `GET /api/db/patients/history/:hpercode` - Fetch admission and encounter history for a patient
- `GET /api/db/patients/:hpercode/encounters/:enccode/records` - Fetch encounter-level clinical records
- `GET /api/db/forms/baby` - Fetch baby/child form header fields from iHOMIS maternal-newborn tables
- `GET /api/db/forms/validation` - Validate whether requested forms already exist for a patient/encounter
- `GET /api/db/chart-tracking` - Fetch CHART Tracking System data with ER/OPD/ADM filtering
- `GET /api/db/chart-tracking/summary` - Get summary statistics by encounter type

### Query params for `/api/db/henctr`

- `enccode` (recommended) - Filter by encounter code
- `fhud` (recommended) - Filter by facility id
- `docointkey` (optional) - Exact document key filter
- `user` (optional) - Exact `hdocord.entryby` filter
- `limit` (optional, default `100`, max `500`)
- `offset` (optional, default `0`)

The response `data` rows contain these fields:

- `enccode`
- `fhud`
- `docointkey`
- `user`
- `firstName`
- `middleName`
- `lastName`

### Query params for `/api/db/patients`

- `search` or `q` (optional) - Matches `enccode`, `fhud`, `docointkey`, or full patient name
- `user` (optional) - Exact `hdocord.entryby` filter
- `fhud` (optional) - Exact `henctr.fhud` filter
- `enccode` (optional) - Exact `hdocord.enccode` filter
- `docointkey` (optional) - Exact `hdocord.docointkey` filter
- `limit` (optional, default `25`, max `200`)
- `offset` (optional, default `0`)

### Query params for `/api/db/patients/history/:hpercode`

- `limit` (optional, default `50`, max `200`)
- `offset` (optional, default `0`)
- `startDate` (optional) - Inclusive admission date lower bound
- `endDate` (optional) - Inclusive admission date upper bound

### Path params for `/api/db/patients/:hpercode/encounters/:enccode/records`

- `hpercode` - Patient code
- `enccode` - Encounter code

This endpoint returns grouped encounter records with keys like:

- `other_details`
- `vital_signs`
- `medical_history`
- `signs_and_symptoms`
- `symptom_physical_others`
- `physical_exam`
- `system_review`
- `ward_course`
- `diagnoses`
- `doctor_orders_medication`
- `medical_supplies`
- `doctor_orders_exams` (filtered to remove discharge-related descriptions)

### Query params for `/api/db/forms/baby`

- `enccode` (optional if `babyHpercode` is provided) - Encounter code from newborn record
- `babyHpercode` (optional if `enccode` is provided) - Baby patient code from `hnewborn.hpercode`

This endpoint returns frontend-ready fields for the baby/child form header:

- `baby_name`
- `baby_sex`
- `baby_age`
- `mother_name`
- `mother_sex`
- `hospital_no`
- `complete_address`
- `type_of_delivery`
- `obstetrician`
- `anesthesia`
- `anesthesiologist`

Data source mapping used by this endpoint:

- baby details: `hnewborn`
- mother details: `henctr` + `hperson`
- hospital number: `COALESCE(hadmlog.pho_hospital_number, henctr.fhud)`
- address: `haddr` + `hbrgy` + `hcity` + `hprov` + `hregion`
- delivery info: `hdelivery`
- obstetrician: `hpostpartum.attenddr` + `hprovider` + `hpersonal`
- anesthesia/anesthesiologist: `hproclog` + `hprovider` + `hpersonal`

### Query params for `/api/db/forms/validation`

- `hpercode` (optional) - Filter validation by patient code
- `enccode` (optional) - Restrict validation to a specific encounter
- `user` (optional) - Restrict validation to a specific form owner/encoder
- `forms` (optional) - Comma-separated list of `docointkey` values to validate

This endpoint returns:

- `patient` - Patient context for the validation request
- `requested_forms` - Forms to validate from the query string
- `submitted_forms` - Forms found in `hdocord`
- `data` - Validation results with `exists` per requested form
- `missing_forms` - Requested forms not yet found in the database
- `existing_forms` - Requested forms already found in the database

### Query params for `/api/db/chart-tracking`

- `type` (optional) - Filter by encounter type: `ER`, `OPD`, or `ADM`
- `hpercode` (optional) - Filter by patient code
- `enccode` (optional) - Filter by encounter code
- `search` (optional) - Search by patient name, patient code, or encounter code
- `limit` (optional, default `50`, max `1000`)
- `offset` (optional, default `0`)

This endpoint returns chart tracking data with fields including:

- `enccode` - Encounter code
- `patient_id` - Patient code (hpercode)
- `patient_name` - Full name (Last, First, Middle)
- `patient_sex` - Male/Female/Unknown
- `hospital_no` - Facility code (fhud)
- `hospital_name` - Facility name
- `encounter_type` - ER, OPD, or ADM
- `encounter_date` - Date of encounter
- `admission_date` - Admission date (for ADM only)
- `discharged_date` - Discharge date
- `phic_status` - PHIC claim status
- `phic_claim_no` - PHIC claim number
- `documents_received` - Count of documents received
- `primary_diagnosis` - Primary diagnosis
- `procedures` - Procedures performed
- `current_status` - Current encounter status
- `records_received` - Yes/No
- `verify_status` - Verification status
- `scan_status` - Scanning status
- `send_status` - Send status
- `records_filed` - Filing status
- `claim_map` - Mapped/Pending

Data sources for chart tracking:

- Encounter data: `henctr`
- Patient data: `hperson`
- Admission data: `hadmlog`
- PHIC claims: `hphicclaim` + `hphicclaimdocument`
- Hospital info: `fhud_hospital`
- Diagnoses: `hencdiag` + `hdiag`
- Procedures: `hproclog` + `hproc`

### GET `/api/db/chart-tracking/summary`

Returns summary statistics grouped by encounter type (ER, OPD, ADM):

- `encounter_type` - Type of encounter
- `total_encounters` - Total number of encounters
- `phic_filed` - Number with PHIC claims filed
- `discharged` - Number of discharged encounters

## Coolify Deployment

This project is ready for Coolify deployment.

### Option A: Node.js / Nixpacks (no Dockerfile required)

- Build command: `npm install`
- Start command: `npm start`
- Port: `3000` (or use Coolify `PORT` env)

### Option B: Dockerfile

A production Dockerfile is included in this repository.

- Dockerfile path: `Dockerfile`
- Exposed container port: `3000`
- Startup command: `npm start`

### Required Environment Variables in Coolify

- `PORT` (optional, defaults to `3000`)
- `MYSQL_HOST`
- `MYSQL_PORT` (optional, defaults to `3306`)
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

### Health Check

Set Coolify health check to:

- `GET /api/health`

## Postman Quick Test

1. Create a `GET` request:
   - URL: `{{baseUrl}}/api/db/henctr`
2. Add query parameters:
   - `enccode`
   - `fhud`
3. Send request.

Example URL:

`http://localhost:3000/api/db/henctr?enccode=TEST-ENC&fhud=TEST-FHUD`

### Example Postman Tests Script

```javascript
pm.test("Status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Response shape is correct", function () {
  const body = pm.response.json();

  pm.expect(body).to.have.property("ok", true);
  pm.expect(body).to.have.property("data").that.is.an("array");
  pm.expect(body).to.have.property("filters");
  pm.expect(body.filters).to.have.property("enccode");
  pm.expect(body.filters).to.have.property("fhud");
});
```

## Notes

Database settings are read from environment variables loaded by `dotenv`.
