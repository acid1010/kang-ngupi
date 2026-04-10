const pakasirBaseUrl = process.env.PAKASIR_BASE_URL || 'https://app.pakasir.com';

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
  const response = await fetch(url, options);
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
