import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock filesystem and fetch before importing processor
vi.mock('../src/queue/fs.js', () => ({
  listQueueFiles: vi.fn(),
  readJson: vi.fn(),
  moveToBucket: vi.fn(),
  inferQueueKindFromFileName: vi.fn(),
  buildQueueFileName: vi.fn()
}));

vi.mock('../src/payments/service.js', () => ({
  createPakasirQrisPayment: vi.fn()
}));

global.fetch = vi.fn();

import { processQueueKind, processAllQueues, retryFailedQueues } from '../src/queue/processor.js';
import { listQueueFiles, readJson, moveToBucket, inferQueueKindFromFileName } from '../src/queue/fs.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDraftPayload(overrides = {}) {
  return {
    event_type: 'draft_order',
    order: {
      client_order_id: 'ORD-20260512-0001',
      payment: { method: 'cash_at_counter', status: 'pending_at_counter' },
      ...overrides
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: webhook succeeds
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
    text: async () => ''
  });
});

// ─── processQueueKind ────────────────────────────────────────────────────────

describe('processQueueKind', () => {
  it('returns empty array when no files in queue', async () => {
    listQueueFiles.mockResolvedValue([]);
    const results = await processQueueKind('draft');
    expect(results).toEqual([]);
  });

  it('processes a single file successfully', async () => {
    const payload = makeDraftPayload();
    listQueueFiles.mockResolvedValue(['/queue/draft/file1.json']);
    readJson.mockResolvedValue(payload);
    moveToBucket.mockResolvedValue('/queue/processed/file1.json');

    const results = await processQueueKind('draft');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('processed');
    expect(results[0].movedTo).toBe('/queue/processed/file1.json');
  });

  it('marks file as failed when webhook returns non-ok', async () => {
    const payload = makeDraftPayload();
    listQueueFiles.mockResolvedValue(['/queue/draft/file1.json']);
    readJson.mockResolvedValue(payload);
    moveToBucket.mockResolvedValue('/queue/failed/file1.json');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const results = await processQueueKind('draft');

    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('500');
  });

  it('marks file as failed when webhook throws (network error)', async () => {
    listQueueFiles.mockResolvedValue(['/queue/draft/file1.json']);
    readJson.mockResolvedValue(makeDraftPayload());
    moveToBucket.mockResolvedValue('/queue/failed/file1.json');
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const results = await processQueueKind('draft');

    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('ECONNREFUSED');
  });

  it('processes multiple files independently (one fail does not block others)', async () => {
    listQueueFiles.mockResolvedValue([
      '/queue/draft/file1.json',
      '/queue/draft/file2.json'
    ]);
    readJson
      .mockResolvedValueOnce(makeDraftPayload({ client_order_id: 'ORD-001' }))
      .mockResolvedValueOnce(makeDraftPayload({ client_order_id: 'ORD-002' }));
    moveToBucket
      .mockResolvedValueOnce('/queue/failed/file1.json')
      .mockResolvedValueOnce('/queue/processed/file2.json');
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }), text: async () => '' });

    const results = await processQueueKind('draft');

    expect(results[0].status).toBe('failed');
    expect(results[1].status).toBe('processed');
  });
});

// ─── processAllQueues ────────────────────────────────────────────────────────

describe('processAllQueues', () => {
  it('processes draft before final', async () => {
    const callOrder = [];
    listQueueFiles.mockImplementation(async (kind) => {
      callOrder.push(kind);
      return [];
    });

    await processAllQueues();

    expect(callOrder[0]).toBe('draft');
    expect(callOrder[1]).toBe('final');
  });

  it('returns both draft and final results', async () => {
    listQueueFiles.mockResolvedValue([]);
    const result = await processAllQueues();
    expect(result).toHaveProperty('draft');
    expect(result).toHaveProperty('final');
    expect(Array.isArray(result.draft)).toBe(true);
    expect(Array.isArray(result.final)).toBe(true);
  });
});

// ─── retryFailedQueues ───────────────────────────────────────────────────────

describe('retryFailedQueues', () => {
  it('moves failed files back to their original queue kind', async () => {
    listQueueFiles.mockImplementation(async (kind) => {
      if (kind === 'failed') return ['/queue/failed/draft-ORD-001.json'];
      return [];
    });
    inferQueueKindFromFileName.mockReturnValue('draft');
    moveToBucket.mockResolvedValue('/queue/draft/draft-ORD-001.json');

    const result = await retryFailedQueues();

    expect(result.requeued).toHaveLength(1);
    expect(result.requeued[0].kind).toBe('draft');
  });

  it('returns empty requeued when no failed files', async () => {
    listQueueFiles.mockResolvedValue([]);
    const result = await retryFailedQueues();
    expect(result.requeued).toHaveLength(0);
  });
});
