export function filterRows(rows, q) {
  const query = (q ?? "").trim().toLowerCase();
  if (!query) return rows;
  return rows.filter(
    (r) =>
      (r.name ?? "").toLowerCase().includes(query) ||
      (r.rel ?? "").toLowerCase().includes(query) ||
      (r.path ?? "").toLowerCase().includes(query),
  );
}
