const pool = require("../config/db");
const { mapBabyFormRow } = require("../utils/dbHelpers");

/**
 * GET /api/db/forms/baby
 * Get newborn/baby form information
 * Query params: enccode, babyHpercode, baby_hpercode, hpercode
 * Requires either enccode or babyHpercode
 */
async function getBabyForm(req, res, next) {
  try {
    const enccode = String(req.query.enccode || "").trim();
    const babyHpercode = String(
      req.query.babyHpercode || req.query.baby_hpercode || req.query.hpercode || "",
    ).trim();

    if (!enccode && !babyHpercode) {
      return res.status(400).json({
        ok: false,
        message: "Either enccode or babyHpercode is required",
      });
    }

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

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

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
         COALESCE(NULLIF(hadm.pho_hospital_number, ''), hen.fhud) AS hospital_number,
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
       LIMIT 1`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: "No baby form data found for the provided filter",
      });
    }

    res.json({
      ok: true,
      filters: {
        enccode: enccode || null,
        babyHpercode: babyHpercode || null,
      },
      data: mapBabyFormRow(rows[0]),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBabyForm,
};
