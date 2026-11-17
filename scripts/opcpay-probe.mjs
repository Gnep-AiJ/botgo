import { mkdir, writeFile } from 'node:fs/promises';
import { opcpay } from 'opcpay';

const apiKey = process.env.opcpay_api_key;
if (!apiKey?.trim()) {
  console.error('Missing opcpay_api_key. Run scripts/opcpay-probe.ps1 to enter it securely.');
  process.exit(1);
}

const resultDirectory = new URL('../artifacts/verification/opcpay/', import.meta.url);
const capabilityFields = [
  'purchase_entry', 'entitlement_query', 'consumption', 'purchase_request_query',
  'purchase_request_list', 'consumption_list', 'webhooks', 'entitlement_monitoring',
  'transaction_query', 'transaction_list', 'refund', 'refund_query', 'bills',
  'automatic_renewal', 'consumption_reversal',
];
const skuFields = [
  'sku_id', 'plan_id', 'display_name', 'billing_mode', 'price', 'currency',
  'price_version', 'entitlement_rule', 'duration_period', 'quota_unit', 'quota_amount',
];

const client = new opcpay();
const queries = [
  ['/capabilities', client.capabilities()],
  ['/product', client.product()],
];
const [capabilities, product] = await Promise.allSettled(queries.map(([, request]) => request));
if (capabilities.status !== 'fulfilled' || product.status !== 'fulfilled') {
  for (const [index, result] of [capabilities, product].entries()) {
    if (result.status === 'fulfilled') continue;
    const status = result.reason?.status;
    const detail = Number.isInteger(status) ? `HTTP ${status}` : 'network error or timeout';
    console.error(`OPCPay ${queries[index][0]} failed (${detail}).`);
  }
  process.exit(1);
}

const merchant = capabilities.value;
const plan = product.value;
if (typeof merchant.provider_configured !== 'boolean' || !merchant.capabilities ||
    typeof plan.capability_status !== 'string' || !Array.isArray(plan.charging_options) ||
    plan.charging_options.some((sku) => !sku || typeof sku !== 'object' || Array.isArray(sku))) {
  console.error('OPCPay returned an unexpected capability or product response.');
  process.exit(1);
}

const summary = {
  checked_at: new Date().toISOString(),
  api_version: typeof merchant.api_version === 'string' ? merchant.api_version : undefined,
  provider_configured: merchant.provider_configured,
  capabilities: Object.fromEntries(capabilityFields.map((name) => [name, merchant.capabilities[name] === true])),
  product: {
    capability_status: plan.capability_status,
    billing_mode: typeof plan.billing_mode === 'string' ? plan.billing_mode : undefined,
    quota_unit: typeof plan.quota_unit === 'string' ? plan.quota_unit : undefined,
    charging_options: plan.charging_options.map((sku) => Object.fromEntries(skuFields
      .filter((name) => ['string', 'number'].includes(typeof sku[name]))
      .map((name) => [name, sku[name]]))),
  },
};

try {
  await mkdir(resultDirectory, { recursive: true });
  const json = JSON.stringify(summary, (_, value) => typeof value === 'string'
    ? value.replaceAll(apiKey, '[REDACTED]')
    : value, 2);
  await writeFile(new URL('merchant.json', resultDirectory), `${json}\n`);
  console.log('OPCPay read-only check complete. See artifacts/verification/opcpay/merchant.json.');
} catch {
  console.error('OPCPay queries succeeded, but the local result could not be saved.');
  process.exitCode = 1;
}
