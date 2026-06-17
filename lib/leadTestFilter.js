// Ryujin OS — Lead test-data filter
// Single source of truth for identifying Cat's QA / smoke-test contacts so
// they can be dropped from every lead number. Both the snapshot KPI path
// (api/snapshot.js) and the lead view (api/leads.js) import this, so the two
// surfaces can never disagree on who is a test contact.
//
// Real customers must NEVER be excluded. The matchers below are deliberately
// tight: word-boundary name tokens (not bare substrings), exact last-10-digit
// phone equality, and explicit test email patterns.

// Multi-word / unambiguous test names matched as substrings (safe — no real
// person's name contains these sequences).
const TEST_NAME_PHRASES = [
  'cat test', 'cat test2', 'cat livetest', 'catherine test',
  'test replied', 'cowork test', 'test fire', 'smoke test', '10cm test',
];
// Single tokens matched at word boundaries so real surnames are not caught
// (e.g. "Testerman", "Montester" must survive).
const TEST_NAME_TOKENS = [/\btest\b/, /\btester\b/, /\bsmoke\b/, /\bzz\b/];

const TEST_EMAIL_RE = [/catherinezeta\./, /catherinealmoitezeta@/, /cazeta270411@/];

// Cat's known test phone numbers (last 10 digits, NANP).
const TEST_PHONES_10 = ['5060123456', '5061234567', '5063213332', '5063331234'];

// Accepts a contact with { name?, firstName?, lastName?, email?, phone? }.
// Name is taken from `name` if present, else assembled from first/last. We do
// NOT fall back to the email for the name-token check — a real lead with no
// name whose email happens to contain "test" must not be classified as a test.
export function isTestData(c) {
  if (!c) return false;
  const name = ((c.name || '') ||
    `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase().trim();
  const email = (c.email || '').toLowerCase().trim();
  const digits = (c.phone || '').replace(/\D/g, '');

  if (name) {
    if (TEST_NAME_PHRASES.some(t => name.includes(t))) return true;
    if (TEST_NAME_TOKENS.some(r => r.test(name))) return true;
  }
  if (email && TEST_EMAIL_RE.some(r => r.test(email))) return true;
  if (digits) {
    const last10 = digits.slice(-10);
    if (TEST_PHONES_10.includes(last10)) return true;
    // +63 Philippines test numbers (country code 63, no NANP leading 1).
    if (digits.startsWith('63') && digits.length > 10) return true;
  }
  return false;
}
