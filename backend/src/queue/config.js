import path from 'node:path';

export const queueRoot = path.resolve(process.cwd(), 'queue', 'orders');
export const queueDirs = {
  draft: path.join(queueRoot, 'draft'),
  final: path.join(queueRoot, 'final'),
  processed: path.join(queueRoot, 'processed'),
  failed: path.join(queueRoot, 'failed')
};

export const webhookUrl = process.env.ORDER_WEBHOOK_URL || 'http://localhost:3001/webhooks/orders';

if (!['http:', 'https:'].includes(new URL(webhookUrl).protocol)) {
  throw new Error('ORDER_WEBHOOK_URL must use http or https protocol');
}
