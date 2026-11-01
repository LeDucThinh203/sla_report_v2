export const CSV_HEADERS = [
  "id",
  "site_id",
  "responder_id",
  "responder",
  "response_business_minutes",
  "within_target",
  "completed_late",
];

/**
 * Formats a single field value according to RFC 4180 CSV rules:
 * - `null` or `undefined` -> `""`
 * - `boolean` -> `"true"` or `"false"`
 * - Fields containing commas, double quotes, CR, or LF are wrapped in double quotes
 *   with internal double quotes doubled (`""`).
 */
export function escapeCsvField(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes evaluated SLA request rows into a CSV string with the exact required header.
 */
export function serializeRequestsToCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.id),
        escapeCsvField(row.site_id),
        escapeCsvField(row.responder_id),
        escapeCsvField(row.responder),
        escapeCsvField(row.response_business_minutes),
        escapeCsvField(row.within_target),
        escapeCsvField(row.completed_late),
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
