import path from 'node:path';

export const sobatNgupiOutboxRoot = process.env.SOBATNGUPI_OUTBOX_DIR
  ? path.resolve(process.env.SOBATNGUPI_OUTBOX_DIR)
  : '/Users/acidjp/.openclaw/workspace-sobatngupi/outbox/order-context';

export const outboxDirs = {
  inbox: sobatNgupiOutboxRoot,
  processed: path.join(sobatNgupiOutboxRoot, 'processed'),
  failed: path.join(sobatNgupiOutboxRoot, 'failed')
};

export const bridgeUrl = process.env.BRIDGE_ORDER_CONTEXT_URL || 'http://localhost:3001/bridge/order-context';
export const outboxScanIntervalMs = Number(process.env.OUTBOX_SCAN_INTERVAL_MS || 5000);
