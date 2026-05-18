const MAX_AVATAR_PX = 320;
const JPEG_QUALITY = 0.82;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("이미지를 읽지 못했어요."));
    };
    reader.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했어요."));
    image.src = src;
  });
}

function resizeDataUrl(dataUrl: string, maxPx: number, quality: number): Promise<string> {
  return loadImage(dataUrl).then((image) => {
    const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("이미지 처리에 실패했어요.");
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  });
}

/** 프로필용으로 압축한 data URL (Supabase JSON 저장) */
export async function readProfileImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 선택할 수 있어요.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("8MB 이하 이미지를 선택해 주세요.");
  }
  const raw = await readFileAsDataUrl(file);
  return resizeDataUrl(raw, MAX_AVATAR_PX, JPEG_QUALITY);
}
