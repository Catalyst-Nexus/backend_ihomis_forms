const pool = require("../config/db");
const { mapPatientRow } = require("../utils/dbHelpers");

/**
 * GET /api/db/patients
 * Search patients with optional name and facility filters
 * Query params: name, facility, page, limit
 */
async function getPatientList(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const name = String(req.query.name || "").trim();
    const facility = String(req.query.facility || "").trim();

    const conditions = [];
    const params = [];

    if (name) {
      const searchTerm = `%${name}%`;
      conditions.push(
        "(p.patlast LIKE ? OR p.patfirst LIKE ? OR p.patmiddle LIKE ? OR p.hpercode LIKE ?)",
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (facility) {
      conditions.push("p.hfhudcode = ?");
      params.push(facility);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const dataQuery = `
      SELECT
        p.hpercode AS hospital_number,
        p.patlast AS last_name,
        p.patfirst AS first_name,
        p.patmiddle AS middle_name,
        CONCAT_WS(' ', p.patlast, p.patfirst, p.patmiddle) AS patient_name,
        p.patsuffix AS suffix,
        p.patsex AS sex,
        p.patbdate AS birth_date,
        p.hfhudcode AS facility_code,
        p.patbplace AS birth_place,
        p.patcstat AS civil_status,
        p.natcode AS nationality,
        p.relcode AS religion,
        p.bldtype AS blood_type,
        p.fatlast AS father_last_name,
        p.fatmid AS father_middle_name,
        p.fatfirst AS father_first_name,
        CONCAT_WS(' ', p.fatlast, p.fatmid, p.fatfirst) AS fathers_name,
        p.motlast AS mother_last_name,
        p.motfirst AS mother_first_name,
        p.motmid AS mother_middle_name,
        CONCAT_WS(' ', p.motlast, p.motfirst, p.motmid) AS mothers_name,
        p.patempstat AS employment_status,
        fh.hfhudname AS facility_name,
        a.brg AS bgycode,
        a.patstr AS street,
        a.ctycode AS city_code,
        a.provcode AS province_code,
        a.patzip AS zip_code,
        b.bgyname AS barangay_name,
        c.ctyname AS city_name,
        pv.provname AS province_name,
        r.regname AS region_name,
        CONCAT_WS(', ', a.patstr, b.bgyname, c.ctyname, pv.provname, r.regname, a.patzip) AS patient_address,
        (
          SELECT ht.pattel
          FROM htelep ht
          WHERE ht.hpercode = p.hpercode
          LIMIT 1
        ) AS telephone_number,
        (SELECT h.casenum FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS case_number,
        (SELECT h.patage FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS age,
        (SELECT h.hpercode FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS hospital_number,
        (SELECT h.admdate FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS admission_date,
        (SELECT h.disdate FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS discharge_date,
        (SELECT h.admtxt FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS chief_complaint,
        (SELECT h.admnotes FROM hadmlog h WHERE h.hpercode = p.hpercode LIMIT 1) AS admission_notes,
        (
          SELECT CONCAT_WS(' ', hp.firstname, hp.middlename, hp.lastname)
          FROM hadmlog h
          LEFT JOIN hprovider pr ON h.licno = pr.licno
          LEFT JOIN hpersonal hp ON pr.employeeid = hp.employeeid
          WHERE h.hpercode = p.hpercode
          LIMIT 1
        ) AS requesting_physician,
        (
          SELECT ph.phicnum
          FROM hphiclog ph
          WHERE ph.hpercode = p.hpercode
          LIMIT 1
        ) AS health_number,
        (
          SELECT rm.rmname
          FROM hpatroom pr
          LEFT JOIN hroom rm ON pr.rmintkey = rm.rmintkey
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS room_name,
        (
          SELECT bd.bdname
          FROM hpatroom pr
          LEFT JOIN hbed bd ON pr.bdintkey = bd.bdintkey
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS bed_name,
        (
          SELECT wd.wardname
          FROM hpatroom pr
          LEFT JOIN hward wd ON pr.wardcode = wd.wardcode
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS ward_name,
        (
          SELECT CONCAT_WS(' - ', 
            (SELECT wd.wardname FROM hpatroom pr LEFT JOIN hward wd ON pr.wardcode = wd.wardcode WHERE pr.hpercode = p.hpercode LIMIT 1),
            (SELECT rm.rmname FROM hpatroom pr LEFT JOIN hroom rm ON pr.rmintkey = rm.rmintkey WHERE pr.hpercode = p.hpercode LIMIT 1),
            (SELECT bd.bdname FROM hpatroom pr LEFT JOIN hbed bd ON pr.bdintkey = bd.bdintkey WHERE pr.hpercode = p.hpercode LIMIT 1)
          )
        ) AS room_number,
        (SELECT vs.vsbp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS blood_pressure,
        (SELECT vs.vstemp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS temperature,
        (SELECT vs.vspulse FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS pulse,
        (SELECT vs.vsresp FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS resp,
        (SELECT vs.o2sats FROM hvitalsign vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS o2sats,
        (SELECT vs.vsweight FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS weight,
        (SELECT vs.vsheight FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS height,
        (SELECT vs.vsbmi FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS bmi,
        (SELECT vs.vsbmicat FROM hvsothr vs WHERE vs.hpercode = p.hpercode LIMIT 1) AS bmi_category,
        (
          SELECT ts.tsdesc
          FROM hpatroom pr
          LEFT JOIN hward wd ON pr.wardcode = wd.wardcode
          LEFT JOIN htypser ts ON wd.tscode = ts.tscode
          WHERE pr.hpercode = p.hpercode
          LIMIT 1
        ) AS ward_category
      FROM hperson p
      LEFT JOIN haddr a ON p.hpercode = a.hpercode
      LEFT JOIN hbrgy b ON a.brg = b.bgycode
      LEFT JOIN hcity c ON a.ctycode = c.ctycode
      LEFT JOIN hprov pv ON a.provcode = pv.provcode
      LEFT JOIN hregion r ON c.ctyreg = r.regcode
      LEFT JOIN fhud_hospital fh ON p.hfhudcode = fh.hfhudcode
      ${whereClause}
      ORDER BY p.patlast, p.patfirst
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM hperson p
      ${whereClause}
    `;

    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    res.json({
      ok: true,
      count: rows.length,
      filters: {
        name: name || null,
        facility: facility || null,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
      data: rows.map(mapPatientRow),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/db/patients/history/:hpercode
 * Get admission/discharge history for a patient
 * Query params: limit, offset, startDate, endDate
 */
async function getPatientHistory(req, res, next) {
  try {
    const hpercode = String(req.params.hpercode || "").trim();
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);

    const limit = Number.isNaN(parsedLimit)
      ? 50
      : Math.min(Math.max(parsedLimit, 1), 200);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    if (!hpercode) {
      return res.status(400).json({
        ok: false,
        message: "hpercode is required",
      });
    }

    let query = `
      SELECT
        a.enccode,
        a.hpercode,
        a.upicode,
        a.casenum,
        a.patage,
        a.newold,
        a.tacode,
        a.tscode,
        a.admdate,
        a.admtime,
        a.diagcode,
        a.admnotes,
        a.licno,
        a.diagfin,
        a.disnotes,
        a.admmode,
        a.admpreg,
        a.disdate,
        a.distime,
        a.dispcode,
        a.condcode,
        a.licnof,
        a.licncons,
        a.cbcode,
        a.dcspinst,
        a.admstat,
        a.admlock,
        a.datemod,
        a.updsw,
        a.confdl,
        a.admtxt,
        a.admclerk,
        a.licno2,
        a.licno3,
        a.licno4,
        a.licno5,
        a.patagemo,
        a.patagedy,
        a.patagehr,
        a.admphic,
        a.disnotice,
        a.treatment,
        a.hsepriv,
        a.licno6,
        a.licno7,
        a.licno8,
        a.licno9,
        a.licno10,
        a.itisind,
        a.entryby,
        a.pexpireddate,
        a.acis,
        a.watchid,
        a.lockby,
        a.lockdte,
        a.typadm,
        a.pho_hospital_number,
        a.nbind,
        a.foradmcode,
        a.is_smoker,
        a.smoker_cigarette_pack,
        a.deleted_at,
        a.created_at,
        a.discharge_by,
        e.fhud AS encounter_fhud,
        e.hpercode AS encounter_hpercode,
        e.encdate AS encounter_date,
        e.enctime AS encounter_time,
        e.toecode AS encounter_toecode,
        e.sopcode1 AS encounter_sopcode1,
        e.sopcode2 AS encounter_sopcode2,
        e.sopcode3 AS encounter_sopcode3,
        e.patinform AS encounter_patinform,
        e.patinfadd AS encounter_patinfadd,
        e.patinftel AS encounter_patinftel,
        e.enclock AS encounter_lock,
        e.datemod AS encounter_datemod,
        e.updsw AS encounter_updsw,
        e.confdl AS encounter_confdl,
        e.acctno AS encounter_acctno,
        e.entryby AS encounter_entryby,
        e.casetype AS encounter_casetype,
        e.tacode AS encounter_tacode,
        e.consentphie AS encounter_consentphie,
        e.cf4attendprov AS encounter_cf4attendprov
      FROM hadmlog a
      LEFT JOIN henctr e ON a.enccode = e.enccode
      WHERE a.hpercode = ?
    `;

    const params = [hpercode];

    if (startDate) {
      query += " AND a.admdate >= ?";
      params.push(startDate);
    }

    if (endDate) {
      query += " AND a.admdate <= ?";
      params.push(endDate);
    }

    query += " ORDER BY a.admdate DESC, a.admtime DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    let countQuery = "SELECT COUNT(*) AS total FROM hadmlog WHERE hpercode = ?";
    const countParams = [hpercode];

    if (startDate) {
      countQuery += " AND admdate >= ?";
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += " AND admdate <= ?";
      countParams.push(endDate);
    }

    const [rows] = await pool.query(query, params);
    const [countRows] = await pool.query(countQuery, countParams);
    const total = countRows[0]?.total || 0;

    res.json({
      ok: true,
      hpercode,
      count: rows.length,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/db/patients (search endpoint)
 * Global patient search across multiple fields
 * Query params: search/q, user, fhud, enccode, docointkey, limit, offset
 */
async function searchPatients(req, res, next) {
  try {
    const { search, q, user, fhud, enccode, docointkey } = req.query;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const parsedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isNaN(parsedLimit)
      ? 25
      : Math.min(Math.max(parsedLimit, 1), 200);
    const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);
    const keyword = String(search || q || "").trim();

    const conditions = [
      "hdocord.docointkey IS NOT NULL",
      "hdocord.docointkey <> ''",
    ];
    const params = [];

    if (fhud) {
      conditions.push("henctr.fhud = ?");
      params.push(fhud);
    }

    if (enccode) {
      conditions.push("hdocord.enccode = ?");
      params.push(enccode);
    }

    if (docointkey) {
      conditions.push("hdocord.docointkey = ?");
      params.push(docointkey);
    }

    if (keyword) {
      conditions.push(
        "(" +
          "hdocord.enccode LIKE ? OR " +
          "henctr.fhud LIKE ? OR " +
          "hdocord.docointkey LIKE ? OR " +
          "CONCAT_WS(' ', hperson.patfirst, hperson.patmiddle, hperson.patlast) LIKE ?" +
          ")",
      );
      const like = `%${keyword}%`;
      params.push(like, like, like, like); 
    }

    if (user) {
      conditions.push("hdocord.entryby = ?");
      params.push(user);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countQuery = `SELECT COUNT(*) AS total FROM hdocord INNER JOIN henctr ON henctr.enccode = hdocord.enccode LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, params);

    const [rows] = await pool.query(
      `SELECT
         hdocord.enccode,
         henctr.fhud,
         hdocord.docointkey,
         hdocord.entryby AS user,
         hperson.hpercode,
         hperson.patlast,
         hperson.patfirst,
         hperson.patmiddle,
         CONCAT_WS(' ', hperson.patlast, hperson.patfirst, hperson.patmiddle) AS patient_name,
         hperson.patsuffix,
         hperson.patsex,
         hperson.patbdate,
         hperson.hfhudcode,
         hperson.patbplace,
         hperson.patcstat,
         hperson.natcode,
         hperson.relcode,
         hperson.pattelno,
         hperson.fatlast,
         hperson.fatmid,
         hperson.fatfirst,
         CONCAT_WS(' ', hperson.fatlast, hperson.fatmid, hperson.fatfirst) AS fathers_name,
         hperson.motlast,
         hperson.motfirst,
         hperson.motmid,
         CONCAT_WS(' ', hperson.motlast, hperson.motfirst, hperson.motmid) AS mothers_name,
         hperson.patempstat,
         fh.hfhudname AS facility_name,
         a.brg AS bgycode,
         a.patstr,
         a.ctycode,
         a.provcode,
         a.patzip,
         b.bgyname,
         c.ctyname,
         pv.provname,
         r.regname,
         CONCAT_WS(', ', a.patstr, b.bgyname, c.ctyname, pv.provname, r.regname, a.patzip) AS patient_address,
         (
           SELECT ht.pattel
           FROM htelep ht
           WHERE ht.hpercode = hperson.hpercode
           LIMIT 1
         ) AS telephone_number,
         (SELECT h.casenum FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS case_number,
         (SELECT h.patage FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS age,
         (SELECT h.hpercode FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS hospital_number,
         (SELECT h.admdate FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS admission_date,
         (SELECT h.disdate FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS discharge_date,
         (SELECT h.admtxt FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS chief_complaint,
         (SELECT h.admnotes FROM hadmlog h WHERE h.hpercode = hperson.hpercode LIMIT 1) AS admission_notes,
         (
           SELECT CONCAT_WS(' ', hp.firstname, hp.middlename, hp.lastname)
           FROM hadmlog h
           LEFT JOIN hprovider pr ON h.licno = pr.licno
           LEFT JOIN hpersonal hp ON pr.employeeid = hp.employeeid
           WHERE h.hpercode = hperson.hpercode
           LIMIT 1
         ) AS requesting_physician,
         (
           SELECT ph.phicnum
           FROM hphiclog ph
           WHERE ph.hpercode = hperson.hpercode
           LIMIT 1
         ) AS health_number,
         (
           SELECT rm.rmname
           FROM hpatroom pr
           LEFT JOIN hroom rm ON pr.rmintkey = rm.rmintkey
           WHERE pr.hpercode = hperson.hpercode
           LIMIT 1
         ) AS room_name,
         (
           SELECT bd.bdname
           FROM hpatroom pr
           LEFT JOIN hbed bd ON pr.bdintkey = bd.bdintkey
           WHERE pr.hpercode = hperson.hpercode
           LIMIT 1
         ) AS bed_name,
         (
           SELECT wd.wardname
           FROM hpatroom pr
           LEFT JOIN hward wd ON pr.wardcode = wd.wardcode
           WHERE pr.hpercode = hperson.hpercode
           LIMIT 1
         ) AS ward_name,
         (
           SELECT CONCAT_WS(' - ', 
             (SELECT wd.wardname FROM hpatroom pr LEFT JOIN hward wd ON pr.wardcode = wd.wardcode WHERE pr.hpercode = hperson.hpercode LIMIT 1),
             (SELECT rm.rmname FROM hpatroom pr LEFT JOIN hroom rm ON pr.rmintkey = rm.rmintkey WHERE pr.hpercode = hperson.hpercode LIMIT 1),
             (SELECT bd.bdname FROM hpatroom pr LEFT JOIN hbed bd ON pr.bdintkey = bd.bdintkey WHERE pr.hpercode = hperson.hpercode LIMIT 1)
           )
         ) AS room_number,
         (SELECT vs.vsbp FROM hvitalsign vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS blood_pressure,
         (SELECT vs.vstemp FROM hvitalsign vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS temperature,
         (SELECT vs.vspulse FROM hvitalsign vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS pulse,
         (SELECT vs.vsresp FROM hvitalsign vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS resp,
         (SELECT vs.o2sats FROM hvitalsign vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS o2sats,
         (SELECT vs.vsweight FROM hvsothr vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS weight,
         (SELECT vs.vsheight FROM hvsothr vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS height,
         (SELECT vs.vsbmi FROM hvsothr vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS bmi,
         (SELECT vs.vsbmicat FROM hvsothr vs WHERE vs.hpercode = hperson.hpercode LIMIT 1) AS bmi_category,
         (
           SELECT ts.tsdesc
           FROM hpatroom pr
           LEFT JOIN hward wd ON pr.wardcode = wd.wardcode
           LEFT JOIN htypser ts ON wd.tscode = ts.tscode
           WHERE pr.hpercode = hperson.hpercode
           LIMIT 1
         ) AS ward_category
       FROM hdocord
       INNER JOIN henctr ON henctr.enccode = hdocord.enccode
       LEFT JOIN hperson ON hperson.hpercode = henctr.hpercode
       LEFT JOIN haddr a ON hperson.hpercode = a.hpercode
       LEFT JOIN hbrgy b ON a.brg = b.bgycode
       LEFT JOIN hcity c ON a.ctycode = c.ctycode
       LEFT JOIN hprov pv ON a.provcode = pv.provcode
       LEFT JOIN hregion r ON c.ctyreg = r.regcode
       LEFT JOIN fhud_hospital fh ON hperson.hfhudcode = fh.hfhudcode
       ${whereClause}
       ORDER BY hdocord.docointkey DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const data = rows.map((row) => ({
      ...mapPatientRow(row),
      enccode: row.enccode || "",
      fhud: row.fhud || "",
      docointkey: row.docointkey || "",
      user: row.user || "",
      firstName: row.patfirst || "",
      middleName: row.patmiddle || "",
      lastName: row.patlast || "",
    }));

    res.json({
      ok: true,
      count: rows.length,
      pagination: { limit, offset, total },
      filters: {
        search: keyword || null,
        user: user || null,
        fhud: fhud || null,
        enccode: enccode || null,
        docointkey: docointkey || null,
      },
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPatientList,
  getPatientHistory,
  searchPatients,
};
