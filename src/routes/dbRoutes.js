const express = require('express');
const {
	dbStatus,
	listTables,
	dbInfo,
	getHenctrInfo,
	getPatientList,
	getPatientHistory,
	getPatientEncounterRecords,
} = require('../controllers/dbController');

const router = express.Router();

router.get('/status', dbStatus);
router.get('/tables', listTables);
router.get('/info', dbInfo);
router.get('/henctr', getHenctrInfo);
router.get('/patients', getPatientList);
router.get('/patients/history/:hpercode', getPatientHistory);
router.get('/patients/:hpercode/encounters/:enccode/records', getPatientEncounterRecords);

module.exports = router;
