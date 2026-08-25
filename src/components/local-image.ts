export const LOCAL_IMAGE_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp';

export const MAX_LOCAL_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set(LOCAL_IMAGE_ACCEPT.split(','));

export function imageFileFromClipboard(
  clipboardData: DataTransfer,
): File | null {
  const file = Array.from(clipboardData.files).find((candidate) =>
    candidate.type.startsWith('image/'),
  );
  if (file) return file;

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const candidate = item.getAsFile();
    if (candidate) return candidate;
  }
  return null;
}

export function readLocalImage(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return Promise.reject(
      new Error('仅支持 JPEG、PNG、GIF 或 WebP 图片。'),
    );
  }
  if (file.size === 0) {
    return Promise.reject(new Error('所选图片为空，请重新选择。'));
  }
  if (file.size > MAX_LOCAL_IMAGE_BYTES) {
    return Promise.reject(new Error('图片不能超过 5 MB。'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('无法读取所选图片，请重新选择。'));
    };
    reader.onerror = () => {
      reject(new Error('无法读取所选图片，请重新选择。'));
    };
    reader.onabort = () => {
      reject(new Error('图片读取已取消。'));
    };
    reader.readAsDataURL(file);
  });
}
