// Gamma API Integration — Proposal Sales Page Generator
// Two modes:
//   1. Template-based: POST /v1.0/generations/from-template (gammaId + prompt)
//   2. Text-based: POST /v1.0/generations (inputText + textMode)
//
// REQUIRES env vars:
//   GAMMA_API_KEY — Mackenzie's Gamma API key
//   GAMMA_TEMPLATE_ID — The Gamma file ID for the proposal template (gammaId)

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';
const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
const GAMMA_TEMPLATE_ID = process.env.GAMMA_TEMPLATE_ID || '';

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

/**
 * Generate a Gamma proposal from estimate data using a template.
 *
 * @param {Object} opts
 * @param {string} opts.customerName
 * @param {string} opts.customerEmail
 * @param {string} opts.address
 * @param {string} opts.city
 * @param {string} opts.province
 * @param {Object} opts.roofSpecs - { squareFeet, pitch, complexity, roofAreaSq }
 * @param {Object} opts.pricing - { gold: { sellingPrice, totalWithTax }, platinum: {...}, diamond: {...} }
 * @param {string} opts.estimateId
 * @param {string} opts.proposalMode
 * @param {string} opts.customMessage
 * @param {string} opts.proposalUrl - Estimator OS proposal link
 * @param {string} [opts.templateId] - override default Gamma template
 * @param {string[]} [opts.photoUrls] - property/inspection photos
 * @returns {Object} { gammaUrl, gammaDocId, status, error }
 */
export async function generateGammaProposal(opts) {
  if (!GAMMA_API_KEY) {
    return { error: 'GAMMA_API_KEY not configured. Set it in Vercel env vars.', status: 'missing_key' };
  }

  const templateId = opts.templateId || GAMMA_TEMPLATE_ID;

  const gold = opts.pricing?.gold || {};
  const platinum = opts.pricing?.platinum || {};
  const diamond = opts.pricing?.diamond || {};

  const roofSQ = opts.roofSpecs?.roofAreaSq || (opts.roofSpecs?.squareFeet ? Math.ceil(opts.roofSpecs.squareFeet / 100) : 'N/A');
  const firstName = (opts.customerName || '').split(' ')[0];
  const proposalDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  const promptText = `
Roofing Proposal for ${opts.customerName || 'Customer'}
Property: ${opts.address || 'N/A'}, ${opts.city || ''}, ${opts.province || 'NB'}
Date: ${proposalDate}

${opts.customMessage || `Hi ${firstName}, thanks for the opportunity to quote your roof. Here are your options.`}

Project Details:
- Estimate ID: ${opts.estimateId || 'N/A'}
- Proposal Type: ${opts.proposalMode || 'Roof Only'}
- Roof Area: ${roofSQ} SQ
- Pitch: ${opts.roofSpecs?.pitch || 'N/A'}
- Complexity: ${opts.roofSpecs?.complexity || 'Standard'}

Package Options:

GOLD PACKAGE — 15-Year Workmanship Warranty
${gold.sellingPrice ? `Subtotal: $${gold.sellingPrice.toLocaleString()}` : ''}
${gold.totalWithTax ? `Total (incl. HST): $${gold.totalWithTax.toLocaleString()}` : ''}

PLATINUM PACKAGE — 20-Year Workmanship Warranty (Recommended)
${platinum.sellingPrice ? `Subtotal: $${platinum.sellingPrice.toLocaleString()}` : ''}
${platinum.totalWithTax ? `Total (incl. HST): $${platinum.totalWithTax.toLocaleString()}` : ''}

DIAMOND PACKAGE — 25-Year Workmanship Warranty
${diamond.sellingPrice ? `Subtotal: $${diamond.sellingPrice.toLocaleString()}` : ''}
${diamond.totalWithTax ? `Total (incl. HST): $${diamond.totalWithTax.toLocaleString()}` : ''}

${opts.proposalUrl ? `View your full interactive proposal: ${opts.proposalUrl}` : ''}

Plus Ultra Roofing — Go Beyond.
Phone: (506) 540-1052
Email: plusultraroofing@gmail.com
Website: plusultraroofing.com
`.trim();

  // If a valid template ID is configured, use template-based generation.
  // Otherwise, fall back to text-based generation (no template needed).
  const useTemplate = !!templateId;

  const generationPayload = useTemplate
    ? { prompt: promptText, gammaId: templateId, sharingOptions: { externalAccess: 'view' } }
    : { inputText: promptText, textMode: 'generate', format: 'document', numCards: 8, sharingOptions: { externalAccess: 'view' } };

  const endpoint = useTemplate
    ? `${GAMMA_BASE}/generations/from-template`
    : `${GAMMA_BASE}/generations`;

  try {
    console.log(`[Gamma] Starting ${useTemplate ? 'template' : 'text-based'} proposal for ${opts.customerName}...`);
    const startResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-KEY': GAMMA_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(generationPayload)
    });

    if (!startResp.ok) {
      const errBody = await startResp.text();
      console.error(`[Gamma] Generation start failed: ${startResp.status} — ${errBody}`);
      return { error: `Gamma API returned ${startResp.status}: ${errBody}`, status: 'api_error' };
    }

    const startData = await startResp.json();
    const generationId = startData.generationId || startData.id;

    if (!generationId) {
      // Some responses include the URL directly
      if (startData.gammaUrl || startData.url || startData.docUrl) {
        return {
          gammaUrl: startData.gammaUrl || startData.url || startData.docUrl,
          gammaDocId: startData.docId || startData.id,
          status: 'complete'
        };
      }
      return { error: 'No generation ID returned', status: 'unexpected_response', raw: startData };
    }

    // Poll for completion
    console.log(`[Gamma] Generation started: ${generationId}. Polling...`);
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollResp = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY }
      });

      if (!pollResp.ok) continue;

      const pollData = await pollResp.json();
      const status = pollData.status || pollData.state;

      if (status === 'complete' || status === 'completed' || status === 'done') {
        const gammaUrl = pollData.gammaUrl || pollData.url || pollData.docUrl || pollData.shareUrl;
        const gammaDocId = pollData.docId || pollData.id;
        console.log(`[Gamma] Proposal complete: ${gammaUrl}`);
        return { gammaUrl, gammaDocId, status: 'complete' };
      }

      if (status === 'failed' || status === 'error') {
        return { error: `Generation failed: ${pollData.error || 'unknown'}`, status: 'generation_failed' };
      }
    }

    return { error: 'Generation timed out after polling', status: 'timeout', generationId };

  } catch (e) {
    console.error(`[Gamma] Error: ${e.message}`);
    return { error: e.message, status: 'exception' };
  }
}

/**
 * Generate a Gamma proposal from free-form text (no template).
 * Uses POST /generations with inputText + textMode.
 */
export async function generateGammaFromText(inputText, options = {}) {
  if (!GAMMA_API_KEY) {
    return { error: 'GAMMA_API_KEY not configured.', status: 'missing_key' };
  }

  const payload = {
    inputText,
    textMode: options.textMode || 'generate',
    format: options.format || 'document',
    numCards: options.numCards || 8,
    ...(options.themeId && { themeId: options.themeId }),
    ...(options.exportAs && { exportAs: options.exportAs }),
    sharingOptions: { externalAccess: 'view' }
  };

  try {
    const startResp = await fetch(`${GAMMA_BASE}/generations`, {
      method: 'POST',
      headers: { 'X-API-KEY': GAMMA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!startResp.ok) {
      const errBody = await startResp.text();
      return { error: `Gamma API ${startResp.status}: ${errBody}`, status: 'api_error' };
    }

    const startData = await startResp.json();
    const generationId = startData.generationId || startData.id;
    if (!generationId) return { error: 'No generation ID returned', status: 'unexpected_response' };

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      const pollResp = await fetch(`${GAMMA_BASE}/generations/${generationId}`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY }
      });
      if (!pollResp.ok) continue;
      const pollData = await pollResp.json();
      const status = pollData.status || pollData.state;
      if (status === 'complete' || status === 'completed' || status === 'done') {
        return {
          gammaUrl: pollData.gammaUrl || pollData.url || pollData.docUrl,
          gammaDocId: pollData.docId || pollData.id,
          status: 'complete'
        };
      }
      if (status === 'failed' || status === 'error') {
        return { error: `Failed: ${pollData.error || 'unknown'}`, status: 'generation_failed' };
      }
    }
    return { error: 'Timed out', status: 'timeout', generationId };
  } catch (e) {
    return { error: e.message, status: 'exception' };
  }
}

/**
 * Quick check if Gamma API is configured and responding.
 */
export async function checkGammaConnection() {
  if (!GAMMA_API_KEY) return { connected: false, reason: 'GAMMA_API_KEY not set' };

  try {
    // Try /me endpoint first, fall back to checking key validity
    const resp = await fetch(`${GAMMA_BASE}/me`, {
      headers: { 'X-API-KEY': GAMMA_API_KEY }
    });
    if (resp.ok) {
      const data = await resp.json();
      return { connected: true, account: data };
    }
    // Even if /me fails, the key might still work for generations
    if (resp.status === 404) return { connected: true, reason: '/me not available but key exists' };
    return { connected: false, reason: `API returned ${resp.status}` };
  } catch (e) {
    return { connected: false, reason: e.message };
  }
}
