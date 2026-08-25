import { describe, expect, it } from 'vitest';

import {
  imageFileFromClipboard,
  MAX_LOCAL_IMAGE_BYTES,
  readLocalImage,
} from '../../src/components/local-image.ts';

describe('readLocalImage', () => {
  it('reads a supported image as a data URL', async () => {
    const file = new File(['pixels'], 'diagram.png', {
      type: 'image/png',
    });

    await expect(readLocalImage(file)).resolves.toBe(
      'data:image/png;base64,cGl4ZWxz',
    );
  });

  it('rejects unsupported and oversized files', async () => {
    await expect(
      readLocalImage(
        new File(['plain text'], 'notes.txt', { type: 'text/plain' }),
      ),
    ).rejects.toThrow('仅支持 JPEG、PNG、GIF 或 WebP 图片。');

    await expect(
      readLocalImage(
        new File(
          [new Uint8Array(MAX_LOCAL_IMAGE_BYTES + 1)],
          'large-image.png',
          { type: 'image/png' },
        ),
      ),
    ).rejects.toThrow('图片不能超过 5 MB。');
  });
});

describe('imageFileFromClipboard', () => {
  it('returns a pasted image and ignores text-only clipboard data', () => {
    const image = new File(['pixels'], 'clipboard.png', {
      type: 'image/png',
    });

    expect(
      imageFileFromClipboard({
        files: [image],
        items: [],
      } as unknown as DataTransfer),
    ).toBe(image);
    expect(
      imageFileFromClipboard({
        files: [],
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image,
          },
        ],
      } as unknown as DataTransfer),
    ).toBe(image);
    expect(
      imageFileFromClipboard({
        files: [],
        items: [
          {
            kind: 'string',
            type: 'text/plain',
          },
        ],
      } as unknown as DataTransfer),
    ).toBeNull();
  });
});
