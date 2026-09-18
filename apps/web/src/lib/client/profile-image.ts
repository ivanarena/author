const PROFILE_IMAGE_SIZE = 256;
const PROFILE_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const PROFILE_IMAGE_MAX_OUTPUT_BYTES = 128 * 1024;
const PROFILE_IMAGE_MAX_DIMENSION = 16_384;
const PROFILE_IMAGE_MAX_PIXELS = 64_000_000;
const ACCEPTED_PROFILE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that profile picture'));
    };
    image.src = url;
  });
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not prepare that profile picture'));
      },
      type,
      quality
    );
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error('Could not prepare that profile picture'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareProfileImage(file: File): Promise<string> {
  if (!ACCEPTED_PROFILE_IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image');
  }
  if (file.size <= 0 || file.size > PROFILE_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error('Profile picture source must be 8 MB or smaller');
  }

  const image = await loadImage(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (
    width <= 0 ||
    height <= 0 ||
    width > PROFILE_IMAGE_MAX_DIMENSION ||
    height > PROFILE_IMAGE_MAX_DIMENSION ||
    width * height > PROFILE_IMAGE_MAX_PIXELS
  ) {
    throw new Error('Profile picture dimensions are too large');
  }

  const canvas = document.createElement('canvas');
  canvas.width = PROFILE_IMAGE_SIZE;
  canvas.height = PROFILE_IMAGE_SIZE;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not prepare that profile picture');

  const cropSize = Math.min(width, height);
  context.drawImage(
    image,
    (width - cropSize) / 2,
    (height - cropSize) / 2,
    cropSize,
    cropSize,
    0,
    0,
    PROFILE_IMAGE_SIZE,
    PROFILE_IMAGE_SIZE
  );

  for (const type of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of [0.84, 0.72, 0.6]) {
      const blob = await canvasBlob(canvas, type, quality);
      if (
        (blob.type === 'image/webp' || blob.type === 'image/jpeg') &&
        blob.size <= PROFILE_IMAGE_MAX_OUTPUT_BYTES
      ) {
        return await blobDataUrl(blob);
      }
    }
  }

  throw new Error('Profile picture could not be reduced below 128 KB');
}
