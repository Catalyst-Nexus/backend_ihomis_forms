const pool = require("../config/db");

/**
 * GET /api/db/users
 * 
 * Fetch users with employee information for tagging functionality
 * Joins users table with hpersonal (employee) table using id = employeeid
 * 
 * Query Parameters:
 * - search: Search by username, email, firstname, lastname (optional)
 * - active: true/false - Filter active users only (optional)
 * - limit: Number of records (default 50, max 1000)
 * - offset: Pagination offset (default 0)
 * 
 * Response Fields:
 * - user_id: User ID from users table
 * - username: Username
 * - email: User email
 * - employee_id: Employee ID from hpersonal table
 * - firstname: Employee first name
 * - lastname: Employee last name
 * - middlename: Employee middle name
 * - posttitle: Job position/title
 * - deptcode: Department code
 * - active: Active status
 */
async function getUsers(req, res, next) {
  try {
    const search = String(req.query.search || "").trim();
    const active = req.query.active;
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let query = `
      SELECT
        u.id AS user_id,
        u.username,
        u.email,
        u.active,
        u.created_on,
        hp.employeeid AS employee_id,
        hp.firstname,
        hp.lastname,
        hp.middlename,
        hp.postitle,
        hp.deptcode,
        hp.contactno,
        CONCAT(
          COALESCE(hp.firstname, ''),
          IF(hp.middlename IS NOT NULL AND hp.middlename != '', CONCAT(' ', hp.middlename), ''),
          ' ',
          COALESCE(hp.lastname, '')
        ) AS full_name
      FROM
        adnph_ihomis_plus.users u
      LEFT JOIN
        adnph_ihomis_plus.hpersonal hp ON u.id = hp.employeeid
      WHERE
        u.deleted_at IS NULL
    `;

    const params = [];

    // Active filter
    if (active !== undefined) {
      const activeValue = active === "true" || active === 1 || active === true;
      query += ` AND u.active = ?`;
      params.push(activeValue ? 1 : 0);
    }

    // Search filter
    if (search) {
      query += `
        AND (
          u.username LIKE ?
          OR u.email LIKE ?
          OR hp.firstname LIKE ?
          OR hp.lastname LIKE ?
          OR hp.middlename LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Order and pagination
    query += ` ORDER BY hp.lastname, hp.firstname LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM adnph_ihomis_plus.users u
      LEFT JOIN adnph_ihomis_plus.hpersonal hp ON u.id = hp.employeeid
      WHERE u.deleted_at IS NULL
    `;
    const countParams = [];

    if (active !== undefined) {
      const activeValue = active === "true" || active === 1 || active === true;
      countQuery += ` AND u.active = ?`;
      countParams.push(activeValue ? 1 : 0);
    }

    if (search) {
      countQuery += `
        AND (
          u.username LIKE ?
          OR u.email LIKE ?
          OR hp.firstname LIKE ?
          OR hp.lastname LIKE ?
          OR hp.middlename LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;

    res.json({
      ok: true,
      data: rows,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
        current_page: Math.floor(offset / limit) + 1,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

/**
 * GET /api/db/users/:userId
 * 
 * Fetch a specific user with employee information
 */
async function getUserById(req, res, next) {
  try {
    const userId = String(req.params.userId || "").trim();

    if (!userId) {
      return res.status(400).json({
        ok: false,
        message: "User ID is required",
      });
    }

    const query = `
      SELECT
        u.id AS user_id,
        u.username,
        u.email,
        u.active,
        u.created_on,
        u.last_login,
        hp.employeeid AS employee_id,
        hp.firstname,
        hp.lastname,
        hp.middlename,
        hp.postitle,
        hp.deptcode,
        hp.contactno,
        hp.extensionname,
        hp.mobilenumber,
        CONCAT(
          COALESCE(hp.firstname, ''),
          IF(hp.middlename IS NOT NULL AND hp.middlename != '', CONCAT(' ', hp.middlename), ''),
          ' ',
          COALESCE(hp.lastname, '')
        ) AS full_name
      FROM
        adnph_ihomis_plus.users u
      LEFT JOIN
        adnph_ihomis_plus.hpersonal hp ON u.id = hp.employeeid
      WHERE
        u.id = ? AND u.deleted_at IS NULL
    `;

    const [rows] = await pool.query(query, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    res.json({
      ok: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to fetch user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

/**
 * GET /api/db/users/search/by-employee/:employeeId
 * 
 * Search users by employee ID
 */
async function searchUserByEmployeeId(req, res, next) {
  try {
    const employeeId = String(req.params.employeeId || "").trim();

    if (!employeeId) {
      return res.status(400).json({
        ok: false,
        message: "Employee ID is required",
      });
    }

    const query = `
      SELECT
        u.id AS user_id,
        u.username,
        u.email,
        u.active,
        hp.employeeid AS employee_id,
        hp.firstname,
        hp.lastname,
        hp.middlename,
        hp.postitle,
        hp.deptcode,
        CONCAT(
          COALESCE(hp.firstname, ''),
          IF(hp.middlename IS NOT NULL AND hp.middlename != '', CONCAT(' ', hp.middlename), ''),
          ' ',
          COALESCE(hp.lastname, '')
        ) AS full_name
      FROM
        adnph_ihomis_plus.users u
      LEFT JOIN
        adnph_ihomis_plus.hpersonal hp ON u.id = hp.employeeid
      WHERE
        hp.employeeid = ? AND u.deleted_at IS NULL
    `;

    const [rows] = await pool.query(query, [employeeId]);

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "User with this employee ID not found",
      });
    }

    res.json({
      ok: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Error searching user by employee ID:", error);
    res.status(500).json({
      ok: false,
      message: "Failed to search user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

module.exports = {
  getUsers,
  getUserById,
  searchUserByEmployeeId,
};
