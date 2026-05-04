function parseFormList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseFormList(item));
  }

  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeValidationQuery(query = {}) {
  return {
    hpercode: String(query.hpercode || query.patientHpercode || "").trim(),
    enccode: String(query.enccode || "").trim(),
    user: String(query.user || query.entryby || "").trim(),
    requestedForms: parseFormList(
      query.forms || query.docointkeys || query.formKeys || query.form_keys,
    ),
  };
}

function buildValidationWhereClause(filters = {}) {
  const conditions = ["hdocord.docointkey IS NOT NULL", "hdocord.docointkey <> ''"];
  const params = [];

  if (filters.hpercode) {
    conditions.push("henctr.hpercode = ?");
    params.push(filters.hpercode);
  }

  if (filters.enccode) {
    conditions.push("hdocord.enccode = ?");
    params.push(filters.enccode);
  }

  if (filters.user) {
    conditions.push("hdocord.entryby = ?");
    params.push(filters.user);
  }

  return {
    conditions,
    params,
    whereClause: `WHERE ${conditions.join(" AND ")}`,
  };
}

function indexSubmittedForms(rows = []) {
  return rows.reduce((index, row) => {
    const docointkey = String(row.docointkey || "").trim();

    if (!docointkey) {
      return index;
    }

    const current =
      index[docointkey] ||
      {
        docointkey,
        total_submissions: 0,
        encounter_codes: new Set(),
        users: new Set(),
      };

    current.total_submissions += Number(row.total_submissions || 0);

    if (row.enccode) {
      current.encounter_codes.add(String(row.enccode).trim());
    }

    if (row.user) {
      current.users.add(String(row.user).trim());
    }

    index[docointkey] = current;
    return index;
  }, {});
}

function serializeSubmissionIndex(index = {}) {
  return Object.values(index).map((item) => ({
    docointkey: item.docointkey,
    total_submissions: item.total_submissions,
    encounter_codes: Array.from(item.encounter_codes),
    users: Array.from(item.users),
    exists: item.total_submissions > 0,
  }));
}

function buildValidationResults(requestedForms, submissionIndex) {
  const formKeys = requestedForms.length
    ? requestedForms
    : Object.keys(submissionIndex);

  return formKeys.map((docointkey) => {
    const submission = submissionIndex[docointkey];

    return {
      docointkey,
      exists: Boolean(submission),
      total_submissions: submission ? submission.total_submissions : 0,
      encounter_codes: submission ? Array.from(submission.encounter_codes) : [],
      users: submission ? Array.from(submission.users) : [],
    };
  });
}

module.exports = {
  parseFormList,
  normalizeValidationQuery,
  buildValidationWhereClause,
  indexSubmittedForms,
  serializeSubmissionIndex,
  buildValidationResults,
};