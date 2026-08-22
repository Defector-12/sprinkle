import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, captureVisibleTab } = vi.hoisted(() => ({
  query: vi.fn(),
  captureVisibleTab: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query, captureVisibleTab },
  },
}));

import {
  captureVisibleTabForSender,
  mapViewportRectToImage,
} from '../../src/runtime/screenshot.ts';

describe('screenshot helpers', () => {
  beforeEach(() => {
    query.mockReset();
    captureVisibleTab.mockReset();
  });

  it('maps layout coordinates through the visual viewport', () => {
    expect(
      mapViewportRectToImage(
        { left: 150, top: 100, width: 200, height: 100 },
        1_000,
        500,
        { width: 500, height: 250, offsetLeft: 100, offsetTop: 50 },
      ),
    ).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it('rejects screenshots when the active tab changes during capture', async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ id: 8 }]);
    captureVisibleTab.mockResolvedValue('data:image/png;base64,pixels');

    await expect(
      captureVisibleTabForSender(7, 3, { format: 'png' }),
    ).rejects.toThrow('截图期间页面发生切换');
  });
});
