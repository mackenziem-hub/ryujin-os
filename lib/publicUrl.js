// Ryujin OS — Public base URL for customer-facing share links.
//
// Customer share links (photos-share, proposal-client) are built from this base
// so a tenant can serve them off a branded domain. Defaults to the Ryujin alias,
// so nothing changes until APP_BASE_URL is set in the environment.
//
// .trim() guards the Vercel env-var newline bug; the trailing-slash strip keeps
// `${publicBase()}/path` from producing a double slash.
export function publicBase() {
  return (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim().replace(/\/+$/, '');
}
