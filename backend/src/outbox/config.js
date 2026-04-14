import path from 'node:path';

export const sobatNgupiOutboxRoot = process.env.SOBATNGUPI_OUTBOX_DIR
  ? path.resolve(process.env.SOBATNGUPI_OUTBOX_DIR)
  : path.resolve(process.cwd(), '..', 'outbox', 'order-context');

export const outboxDirs = {
  inbox: sobatNgupiOutboxRoot,
  processed: path.join(sobatNgupiOutboxRoot, 'processed'),
  failed: path.join(sobatNgupiOutboxRoot, 'failed')
};

export const bridgeUrl = process.env.BRIDGE_ORDER_CONTEXT_URL || 'http://localhost:3001/bridge/order-context';
if (!['http:', 'https:'].includes(new URL(bridgeUrl).protocol)) {
  throw new Error('BRIDGE_ORDER_CONTEXT_URL must use http or https protocol');
}

const outboxScanIntervalRaw = Number(process.env.OUTBOX_SCAN_INTERVAL_MS || 5000);
if (!Number.isFinite(outboxScanIntervalRaw) || outboxScanIntervalRaw < 1000) {
  throw new Error('OUTBOX_SCAN_INTERVAL_MS must be a number >= 1000');
}

export const outboxScanIntervalMs = outboxScanIntervalRaw;
