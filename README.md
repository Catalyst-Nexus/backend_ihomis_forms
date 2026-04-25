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
- `GET /api/db/henctr` - Fetch `enccode` and `fhud` from `henctr`
- `GET /api/db/patients` - Fetch paginated patient list with optional filters
- `GET /api/db/patients/history/:hpercode` - Fetch admission and encounter history for a patient
- `GET /api/db/patients/:hpercode/encounters/:enccode/records` - Fetch encounter-level clinical records

### Query params for `/api/db/henctr`

- `enccode` (recommended) - Filter by encounter code
- `fhud` (recommended) - Filter by facility id
- `limit` (optional, default `100`, max `500`)
- `offset` (optional, default `0`)

The response `data` rows contain only these fields:

- `enccode`
- `fhud`

### Query params for `/api/db/patients`

- `page` (optional, default `1`)
- `limit` (optional, default `20`, max `100`)
- `name` (optional) - Matches patient last/first/middle name or `hpercode`
- `facility` (optional) - Exact `hfhudcode` filter

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
pm.test('Status code is 200', function () {
   pm.response.to.have.status(200);
});

pm.test('Response shape is correct', function () {
   const body = pm.response.json();

   pm.expect(body).to.have.property('ok', true);
   pm.expect(body).to.have.property('data').that.is.an('array');
   pm.expect(body).to.have.property('filters');
   pm.expect(body.filters).to.have.property('enccode');
   pm.expect(body.filters).to.have.property('fhud');
});
```

## Notes

Database settings are read from environment variables loaded by `dotenv`.
