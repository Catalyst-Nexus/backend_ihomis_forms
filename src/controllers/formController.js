const pool = require("../config/db");
const { mapBabyFormRow } = require("../utils/dbHelpers");

/**
 * GET /api/db/forms/baby
 * Get newborn/baby form information
 * Supports filtering by encounter code or baby person code
 * 
 * Query params (all optional):
 * - enccode: Encounter code (optional)
 * - babyHpercode: Baby person code (optional)
 * - baby_hpercode: Alternative baby person code parameter (optional)
 * - hpercode: Alternative person code parameter (optional)
 * - limit: Number of records (default 50, max 1000)
 * - offset: Pagination offset (default 0)
 */
async function getBabyForm(req, res, next) {
  try {
    const enccode = String(req.query.enccode || "").trim();
    const babyHpercode = String(
      req.query.babyHpercode || req.query.baby_hpercode || req.query.hpercode || "",
    ).trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const conditions = [];
    const params = [];

    if (enccode) {
      conditions.push("nb.enccode = ?");
      params.push(enccode);
    }

    if (babyHpercode) {
      conditions.push("nb.hpercode = ?");
      params.push(babyHpercode);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT
         nb.enccode,
         nb.hpercode AS baby_hpercode,
         nb.firstname AS baby_first_name,
         nb.middlename AS baby_middle_name,
         nb.lastname AS baby_last_name,
         nb.sex AS baby_sex_code,
         nb.birthdate AS baby_birth_date,
         hen.hpercode AS mother_hpercode,
         hp.patfirst AS mother_first_name,
         hp.patmiddle AS mother_middle_name,
         hp.patlast AS mother_last_name,
         hp.patsuffix AS mother_suffix,
         hp.patsex AS mother_sex_code,
         COALESCE(NULLIF(hadm.pho_hospital_number, ''), nb.hpercode) AS hospital_number,
         hd.del_presentation AS delivery_type,
         hd.obindex AS ob_index,
         hd.deliverydte AS delivery_date,
         (
           SELECT ad.patstr
           FROM haddr ad
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_street,
         (
           SELECT ad.brg
           FROM haddr ad
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_barangay_code,
         (
           SELECT br.bgyname
           FROM haddr ad
           INNER JOIN hbrgy br ON br.bgycode = ad.brg
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_barangay,
         (
           SELECT ct.ctyname
           FROM haddr ad
           INNER JOIN hcity ct ON ct.ctycode = ad.ctycode
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_city,
         (
           SELECT pv.provname
           FROM haddr ad
           INNER JOIN hprov pv ON pv.provcode = ad.provcode
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_province,
         (
           SELECT rg.regname
           FROM haddr ad
           INNER JOIN hcity ct ON ct.ctycode = ad.ctycode
           INNER JOIN hregion rg ON rg.regcode = ct.ctyreg
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_region,
         (
           SELECT ad.patzip
           FROM haddr ad
           WHERE ad.hpercode = hp.hpercode
           LIMIT 1
         ) AS address_zip,
         (
           SELECT pp.attenddr
           FROM hpostpartum pp
           WHERE pp.enccode = nb.enccode
             AND pp.attenddr IS NOT NULL
             AND pp.attenddr <> ''
           ORDER BY pp.attendsigndate DESC
           LIMIT 1
         ) AS obstetrician_license_no,
         (
           SELECT CONCAT_WS(' ', pe.firstname, pe.middlename, pe.lastname, pe.empsuffix)
           FROM hpostpartum pp
           INNER JOIN hprovider pr ON pr.licno = pp.attenddr
           INNER JOIN hpersonal pe ON pe.employeeid = pr.employeeid
           WHERE pp.enccode = nb.enccode
             AND pp.attenddr IS NOT NULL
             AND pp.attenddr <> ''
           ORDER BY pp.attendsigndate DESC
           LIMIT 1
         ) AS obstetrician_name,
         (
           SELECT pl.anestype
           FROM hproclog pl
           WHERE pl.enccode = nb.enccode
             AND pl.anestype IS NOT NULL
             AND pl.anestype <> ''
           ORDER BY pl.hplscdte DESC
           LIMIT 1
         ) AS anesthesia_type,
         (
           SELECT pl.aneslicno
           FROM hproclog pl
           WHERE pl.enccode = nb.enccode
             AND pl.aneslicno IS NOT NULL
             AND pl.aneslicno <> ''
           ORDER BY pl.hplscdte DESC
           LIMIT 1
         ) AS anesthesiologist_license_no,
         (
           SELECT CONCAT_WS(' ', pe.firstname, pe.middlename, pe.lastname, pe.empsuffix)
           FROM hproclog pl
           INNER JOIN hprovider pr ON pr.licno = pl.aneslicno
           INNER JOIN hpersonal pe ON pe.employeeid = pr.employeeid
           WHERE pl.enccode = nb.enccode
             AND pl.aneslicno IS NOT NULL
             AND pl.aneslicno <> ''
           ORDER BY pl.hplscdte DESC
           LIMIT 1
         ) AS anesthesiologist_name
       FROM hnewborn nb
       LEFT JOIN henctr hen ON hen.enccode = nb.enccode
       LEFT JOIN hperson hp ON hp.hpercode = hen.hpercode
       LEFT JOIN hadmlog hadm ON hadm.enccode = nb.enccode
       LEFT JOIN hdelivery hd ON hd.enccode = nb.enccode
       ${whereClause}
       ORDER BY nb.birthdate DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      ok: true,
      filters: {
        enccode: enccode || null,
        babyHpercode: babyHpercode || null,
      },
      pagination: {
        limit,
        offset,
        count: rows.length,
      },
      data: rows.map(row => mapBabyFormRow(row)),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/db/forms/baby
 * Create a new baby form/newborn record
 * Body: {
 *   enccode: string (required) - Encounter code
 *   baby_first_name: string (required)
 *   baby_middle_name: string (optional)
 *   baby_last_name: string (required)
 *   baby_sex: string (required) - M or F
 *   baby_birth_date: string (required) - YYYY-MM-DD format
 * }
 */
async function createBabyForm(req, res, next) {
  try {
    const {
      enccode,
      baby_first_name,
      baby_middle_name,
      baby_last_name,
      baby_sex,
      baby_birth_date,
    } = req.body;

    // Validation
    if (!enccode || !baby_first_name || !baby_last_name || !baby_sex || !baby_birth_date) {
      return res.status(400).json({
        ok: false,
        message: "Missing required fields: enccode, baby_first_name, baby_last_name, baby_sex, baby_birth_date",
      });
    }

    // Validate sex code
    if (!["M", "F"].includes(baby_sex.toUpperCase())) {
      return res.status(400).json({
        ok: false,
        message: "baby_sex must be 'M' or 'F'",
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baby_birth_date)) {
      return res.status(400).json({
        ok: false,
        message: "baby_birth_date must be in YYYY-MM-DD format",
      });
    }

    // Check if encounter exists
    const [encounterCheck] = await pool.query(
      "SELECT enccode FROM henctr WHERE enccode = ?",
      [enccode]
    );

    if (!encounterCheck.length) {
      return res.status(404).json({
        ok: false,
        message: "Encounter not found",
      });
    }

    // Get mother's hpercode from encounter
    const [motherData] = await pool.query(
      "SELECT hpercode FROM henctr WHERE enccode = ?",
      [enccode]
    );

    if (!motherData.length) {
      return res.status(400).json({
        ok: false,
        message: "Could not find mother information for this encounter",
      });
    }

    const mother_hpercode = motherData[0].hpercode;

    // Generate unique baby hpercode (you might want to use your hospital's ID generation)
    const [maxId] = await pool.query(
      "SELECT MAX(CAST(SUBSTRING(hpercode, -6) AS UNSIGNED)) as max_id FROM hperson"
    );
    const newId = (maxId[0]?.max_id || 0) + 1;
    const baby_hpercode = String(newId).padStart(6, "0");

    // Insert into hnewborn table
    const [result] = await pool.query(
      `INSERT INTO hnewborn (
        enccode,
        hpercode,
        firstname,
        middlename,
        lastname,
        sex,
        birthdate
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        enccode,
        baby_hpercode,
        baby_first_name.trim(),
        baby_middle_name ? baby_middle_name.trim() : "",
        baby_last_name.trim(),
        baby_sex.toUpperCase(),
        baby_birth_date,
      ]
    );

    // Fetch the created baby form
    const [babyForm] = await pool.query(
      `SELECT
         nb.enccode,
         nb.hpercode AS baby_hpercode,
         nb.firstname AS baby_first_name,
         nb.middlename AS baby_middle_name,
         nb.lastname AS baby_last_name,
         nb.sex AS baby_sex_code,
         nb.birthdate AS baby_birth_date
       FROM hnewborn nb
       WHERE nb.hpercode = ?`,
      [baby_hpercode]
    );

    res.status(201).json({
      ok: true,
      message: "Baby form created successfully",
      data: babyForm[0] || {
        enccode,
        baby_hpercode,
        baby_first_name,
        baby_middle_name: baby_middle_name || "",
        baby_last_name,
        baby_sex_code: baby_sex.toUpperCase(),
        baby_birth_date,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBabyForm,
  createBabyForm,
};
