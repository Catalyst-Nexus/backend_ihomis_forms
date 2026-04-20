const express = require('express');
const { dbStatus, listTables, dbInfo, getHenctrInfo } = require('../controllers/dbController');

const router = express.Router();

router.get('/status', dbStatus);
router.get('/tables', listTables);
router.get('/info', dbInfo);
router.get('/henctr', getHenctrInfo);

module.exports = router;
