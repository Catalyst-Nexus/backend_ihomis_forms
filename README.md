# iHOMIS Forms Backend

Express.js backend for iHOMIS Forms with MySQL connection via environment variables.

## Prerequisites

- Node.js 18+
- npm

## Setup

1. Install dependencies:
   npm install
2. Create environment file:
   Copy `.env.example` to `.env` and update values.
3. Start development server:
   npm run dev

## Available Scripts

- `npm run dev` - Start server with nodemon
- `npm start` - Start server in production mode

## API Endpoints

- `GET /` - API info
- `GET /api/health` - Service health
- `GET /api/db/status` - MySQL connection check
- `GET /api/db/tables` - List database tables
- `GET /api/db/info` - Database name and facility code discovery info
- `GET /api/db/henctr` - Fetch `enccode`, `fhud`, `hpercode` from `henctr`

### Query params for `/api/db/henctr`

- `enccode` (optional) - Filter by encounter code
- `fhud` (optional) - Filter by facility id
- `hpercode` (optional) - Filter by patient code
- `limit` (optional, default `100`, max `500`)
- `offset` (optional, default `0`)

## Notes

Database settings are read from environment variables loaded by `dotenv`.
