const pakasirBaseUrl = process.env.PAKASIR_BASE_URL || 'https://app.pakasir.com';
const pakasirRequestTimeoutMs = Number(process.env.PAKASIR_REQUEST_TIMEOUT_MS || 15000);

if (!Number.isFinite(pakasirRequestTimeoutMs) || pakasirRequestTimeoutMs < 1000) {
  throw new Error('PAKASIR_REQUEST_TIMEOUT_MS must be a number >= 1000');
}

if (!['http:', 'https:'].includes(new URL(pakasirBaseUrl).protocol)) {
  throw new Error('PAKASIR_BASE_URL must use http or https protocol');
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getJsonHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pakasirRequestTimeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Pakasir request timeout after ${pakasirRequestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(`Pakasir request failed (${response.status}): ${text || response.statusText}`);
  }

  return parsed;
}

export function getPakasirConfig() {
  return {
    baseUrl: pakasirBaseUrl,
    projectSlug: getRequiredEnv('PAKASIR_PROJECT_SLUG'),
    apiKey: getRequiredEnv('PAKASIR_API_KEY')
  };
}

export async function createQrisTransaction({ orderId, amount }) {
  const { baseUrl, projectSlug, apiKey } = getPakasirConfig();
  const url = `${baseUrl}/api/transactioncreate/qris`;
  const body = {
    project: projectSlug,
    order_id: orderId,
    amount,
    api_key: apiKey
  };

  return fetchJson(url, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify(body)
  });
}

export async function getTransactionDetail({ orderId, amount }) {
  const { baseUrl, projectSlug, apiKey } = getPakasirConfig();
  const query = new URLSearchParams({
    project: projectSlug,
    amount: String(amount),
    order_id: orderId,
    api_key: apiKey
  });

  return fetchJson(`${baseUrl}/api/transactiondetail?${query.toString()}`);
}
