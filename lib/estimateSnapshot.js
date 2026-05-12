// Estimate snapshot helper — STUB.
//
// api/estimates.js calls captureEstimateSnapshot on every POST/PUT to
// preserve a versioned record of the estimate at that point in time.
// The real implementation (table writes, diff vs previous version,
// suppress on no-op pricing changes) was started last session and not
// finished — only the call sites and import landed, which crashed
// /api/estimates on module load (MODULE_NOT_FOUND) and broke the
// proposals UI in prod.
//
// This stub restores /api/estimates by satisfying the import. It does
// nothing. Implement the real version when designing the
// estimate_snapshots table + diff logic.
export function captureEstimateSnapshot(_supabase, _opts) {
  return Promise.resolve(null);
}
