/**
 * 5K AI-Guided Super-Resolution Upscaler (5120px Target Long Edge)
 * Combines Gemini AI content-profile analysis with YCbCr chroma artifact suppression,
 * edge-preserving luma denoising, anti-ringing separable Lanczos-3 resampling,
 * and dual-band luminance micro-detail sharpening.
 */

export const TARGET_5K_LONG_EDGE = 5120;

export interface UpscaleAnalysisProfile {
  contentCategory:
    | 'photo'
    | 'portrait'
    | 'illustration'
    | 'anime_lineart'
    | 'text_ui'
    | 'mixed';
  denoiseStrength: number; // 0..100
  chromaDenoise: number; // 0..100
  edgeSharpness: number; // 0..100
  textureBoost: number; // 0..100
  microContrast: number; // 0..100
  dehaloStrength: number; // 0..100
  upscaleNotes: string;
  modelUsed?: string;
}

export interface Upscale5KResult {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  profile: UpscaleAnalysisProfile;
}

const DEFAULT_PROFILE: UpscaleAnalysisProfile = {
  contentCategory: 'mixed',
  denoiseStrength: 26,
  chromaDenoise: 42,
  edgeSharpness: 72,
  textureBoost: 48,
  microContrast: 32,
  dehaloStrength: 80,
  upscaleNotes:
    'AI-guided 5K super-resolution with chroma cleanup and dual-band detail clarity',
  modelUsed: 'gemini-4-hydrogen',
};

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczosKernel(x: number, a = 3): number {
  const ax = Math.abs(x);
  if (ax >= a) return 0;
  return sinc(x) * sinc(x / a);
}

function buildAnalysisPreviewBase64(img: HTMLImageElement): {
  base64: string;
  mimeType: string;
} {
  const srcW = img.naturalWidth || img.width || 800;
  const srcH = img.naturalHeight || img.height || 600;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return {
    base64: dataUrl.split(',')[1] || '',
    mimeType: 'image/jpeg',
  };
}

function clampNum(
  val: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof val !== 'number' || Number.isNaN(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

async function analyzeImageFor5KUpscale(
  img: HTMLImageElement
): Promise<UpscaleAnalysisProfile> {
  try {
    const { base64, mimeType } = buildAnalysisPreviewBase64(img);
    const resp = await fetch('/api/upscale/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
    });
    if (!resp.ok) {
      return DEFAULT_PROFILE;
    }
    const data = await resp.json();
    return {
      contentCategory: data.contentCategory || DEFAULT_PROFILE.contentCategory,
      denoiseStrength: clampNum(
        data.denoiseStrength,
        0,
        100,
        DEFAULT_PROFILE.denoiseStrength
      ),
      chromaDenoise: clampNum(
        data.chromaDenoise,
        0,
        100,
        DEFAULT_PROFILE.chromaDenoise
      ),
      edgeSharpness: clampNum(
        data.edgeSharpness,
        0,
        100,
        DEFAULT_PROFILE.edgeSharpness
      ),
      textureBoost: clampNum(
        data.textureBoost,
        0,
        100,
        DEFAULT_PROFILE.textureBoost
      ),
      microContrast: clampNum(
        data.microContrast,
        0,
        100,
        DEFAULT_PROFILE.microContrast
      ),
      dehaloStrength: clampNum(
        data.dehaloStrength,
        0,
        100,
        DEFAULT_PROFILE.dehaloStrength
      ),
      upscaleNotes: data.upscaleNotes || DEFAULT_PROFILE.upscaleNotes,
      modelUsed: data.modelUsed || 'gemini-4-hydrogen',
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

/**
 * Stage 1: YCbCr Chroma Artifact Suppression + Edge-Preserving Luma Bilateral Denoise.
 * Suppresses JPEG color blotching in Cb/Cr without softening crisp luminance edges.
 */
function applyChromaAndEdgeDenoise(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  lumaDenoise: number,
  chromaDenoise: number
): Uint8ClampedArray {
  if (lumaDenoise <= 5 && chromaDenoise <= 5) return src;
  const out = new Uint8ClampedArray(src.length);
  const lumaBlend = (lumaDenoise / 100) * 0.6;
  const chromaBlend = (chromaDenoise / 100) * 0.78;
  const lumaRangeSq = 2 * Math.pow(9 + lumaDenoise * 0.3, 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cIdx = (y * width + x) * 4;
      const cr = src[cIdx];
      const cg = src[cIdx + 1];
      const cb = src[cIdx + 2];
      const ca = src[cIdx + 3];

      const cY = 0.299 * cr + 0.587 * cg + 0.114 * cb;
      const cCb = -0.168736 * cr - 0.331264 * cg + 0.5 * cb;
      const cCr = 0.5 * cr - 0.418688 * cg - 0.081312 * cb;

      let ySum = 0;
      let yW = 0;
      let cbSum = 0;
      let crSum = 0;
      let cW = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const nIdx = (ny * width + nx) * 4;
          const nr = src[nIdx];
          const ng = src[nIdx + 1];
          const nb = src[nIdx + 2];

          const nY = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const dY = nY - cY;
          const spatialW =
            dx === 0 && dy === 0 ? 1.5 : dx === 0 || dy === 0 ? 1.0 : 0.7;

          const wL = spatialW * Math.exp(-(dY * dY) / lumaRangeSq);
          ySum += nY * wL;
          yW += wL;

          // Chroma smoothing respects strong luma boundaries to avoid color bleeding
          const edgeGate = Math.exp(-(dY * dY) / 1600);
          const wC = spatialW * edgeGate;
          cbSum += (-0.168736 * nr - 0.331264 * ng + 0.5 * nb) * wC;
          crSum += (0.5 * nr - 0.418688 * ng - 0.081312 * nb) * wC;
          cW += wC;
        }
      }

      const finalY = cY * (1 - lumaBlend) + (ySum / yW) * lumaBlend;
      const finalCb =
        cW > 0 ? cCb * (1 - chromaBlend) + (cbSum / cW) * chromaBlend : cCb;
      const finalCr =
        cW > 0 ? cCr * (1 - chromaBlend) + (crSum / cW) * chromaBlend : cCr;

      const rr = finalY + 1.402 * finalCr;
      const gg = finalY - 0.344136 * finalCb - 0.714136 * finalCr;
      const bb = finalY + 1.772 * finalCb;

      out[cIdx] = rr < 0 ? 0 : rr > 255 ? 255 : Math.round(rr);
      out[cIdx + 1] = gg < 0 ? 0 : gg > 255 ? 255 : Math.round(gg);
      out[cIdx + 2] = bb < 0 ? 0 : bb > 255 ? 255 : Math.round(bb);
      out[cIdx + 3] = ca;
    }
  }
  return out;
}

/**
 * Stage 2: Separable Lanczos-3 Resampler with Anti-Ringing Neighborhood Clamping.
 */
async function lanczos3Resample(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  dehaloStrength: number
): Promise<Uint8ClampedArray> {
  const a = 3;
  const antiRing = Math.max(0, Math.min(1, dehaloStrength / 100));

  const hScale = srcW / dstW;
  const hRadius = Math.max(a, a * hScale);
  const hTapMax = Math.ceil(hRadius * 2) + 2;
  const hStart = new Int32Array(dstW);
  const hCount = new Uint8Array(dstW);
  const hWeights = new Float32Array(dstW * hTapMax);

  for (let x = 0; x < dstW; x++) {
    const center = (x + 0.5) * hScale - 0.5;
    const left = Math.max(0, Math.floor(center - hRadius));
    const right = Math.min(srcW - 1, Math.ceil(center + hRadius));
    hStart[x] = left;
    const count = right - left + 1;
    hCount[x] = count;

    let wSum = 0;
    const base = x * hTapMax;
    for (let j = 0; j < count; j++) {
      const dist = (left + j - center) / Math.max(1, hScale);
      const w = lanczosKernel(dist, a);
      hWeights[base + j] = w;
      wSum += w;
    }
    if (wSum !== 0) {
      for (let j = 0; j < count; j++) {
        hWeights[base + j] /= wSum;
      }
    }
  }

  const horiz = new Uint8ClampedArray(dstW * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    const srcRowOffset = y * srcW * 4;
    const dstRowOffset = y * dstW * 4;

    for (let x = 0; x < dstW; x++) {
      const left = hStart[x];
      const count = hCount[x];
      const wBase = x * hTapMax;

      let r = 0,
        g = 0,
        b = 0,
        al = 0;
      let minR = 255,
        maxR = 0,
        minG = 255,
        maxG = 0,
        minB = 255,
        maxB = 0;

      for (let j = 0; j < count; j++) {
        const w = hWeights[wBase + j];
        const sIdx = srcRowOffset + (left + j) * 4;
        const sr = src[sIdx];
        const sg = src[sIdx + 1];
        const sb = src[sIdx + 2];
        const sa = src[sIdx + 3];

        r += sr * w;
        g += sg * w;
        b += sb * w;
        al += sa * w;

        if (w > 0) {
          if (sr < minR) minR = sr;
          if (sr > maxR) maxR = sr;
          if (sg < minG) minG = sg;
          if (sg > maxG) maxG = sg;
          if (sb < minB) minB = sb;
          if (sb > maxB) maxB = sb;
        }
      }

      if (antiRing > 0) {
        const clampR = Math.min(maxR, Math.max(minR, r));
        const clampG = Math.min(maxG, Math.max(minG, g));
        const clampB = Math.min(maxB, Math.max(minB, b));
        r = r * (1 - antiRing) + clampR * antiRing;
        g = g * (1 - antiRing) + clampG * antiRing;
        b = b * (1 - antiRing) + clampB * antiRing;
      }

      const dIdx = dstRowOffset + x * 4;
      horiz[dIdx] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      horiz[dIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
      horiz[dIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
      horiz[dIdx + 3] = al < 0 ? 0 : al > 255 ? 255 : Math.round(al);
    }

    if (y % 128 === 127) {
      await yieldToMain();
    }
  }

  const vScale = srcH / dstH;
  const vRadius = Math.max(a, a * vScale);
  const vTapMax = Math.ceil(vRadius * 2) + 2;
  const vStart = new Int32Array(dstH);
  const vCount = new Uint8Array(dstH);
  const vWeights = new Float32Array(dstH * vTapMax);

  for (let y = 0; y < dstH; y++) {
    const center = (y + 0.5) * vScale - 0.5;
    const top = Math.max(0, Math.floor(center - vRadius));
    const bottom = Math.min(srcH - 1, Math.ceil(center + vRadius));
    vStart[y] = top;
    const count = bottom - top + 1;
    vCount[y] = count;

    let wSum = 0;
    const base = y * vTapMax;
    for (let j = 0; j < count; j++) {
      const dist = (top + j - center) / Math.max(1, vScale);
      const w = lanczosKernel(dist, a);
      vWeights[base + j] = w;
      wSum += w;
    }
    if (wSum !== 0) {
      for (let j = 0; j < count; j++) {
        vWeights[base + j] /= wSum;
      }
    }
  }

  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const rowStride = dstW * 4;

  for (let y = 0; y < dstH; y++) {
    const top = vStart[y];
    const count = vCount[y];
    const wBase = y * vTapMax;
    const dstRowOffset = y * rowStride;

    for (let x = 0; x < dstW; x++) {
      const xOffset = x * 4;
      let r = 0,
        g = 0,
        b = 0,
        al = 0;
      let minR = 255,
        maxR = 0,
        minG = 255,
        maxG = 0,
        minB = 255,
        maxB = 0;

      for (let j = 0; j < count; j++) {
        const w = vWeights[wBase + j];
        const sIdx = (top + j) * rowStride + xOffset;
        const sr = horiz[sIdx];
        const sg = horiz[sIdx + 1];
        const sb = horiz[sIdx + 2];
        const sa = horiz[sIdx + 3];

        r += sr * w;
        g += sg * w;
        b += sb * w;
        al += sa * w;

        if (w > 0) {
          if (sr < minR) minR = sr;
          if (sr > maxR) maxR = sr;
          if (sg < minG) minG = sg;
          if (sg > maxG) maxG = sg;
          if (sb < minB) minB = sb;
          if (sb > maxB) maxB = sb;
        }
      }

      if (antiRing > 0) {
        const clampR = Math.min(maxR, Math.max(minR, r));
        const clampG = Math.min(maxG, Math.max(minG, g));
        const clampB = Math.min(maxB, Math.max(minB, b));
        r = r * (1 - antiRing) + clampR * antiRing;
        g = g * (1 - antiRing) + clampG * antiRing;
        b = b * (1 - antiRing) + clampB * antiRing;
      }

      const dIdx = dstRowOffset + xOffset;
      dst[dIdx] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
      dst[dIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
      dst[dIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
      dst[dIdx + 3] = al < 0 ? 0 : al > 255 ? 255 : Math.round(al);
    }

    if (y % 256 === 255) {
      await yieldToMain();
    }
  }

  return dst;
}

/**
 * Stage 3: Dual-Band AI-Guided Luminance Detail Enhancement.
 * - Band 1 (3x3 fine radius): edge crispness for line art, eyelashes, hair, and text.
 * - Band 2 (5x5 medium radius): micro-texture clarity and midtone depth without amplifying flat noise.
 */
async function applyDualBandLuminanceEnhancement(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edgeSharpness: number,
  textureBoost: number,
  microContrast: number
): Promise<void> {
  const fineAmount = (edgeSharpness / 100) * 0.78;
  const texAmount = (textureBoost / 100) * 0.42;
  const contrastAmount = (microContrast / 100) * 0.22;
  if (fineAmount <= 0.02 && texAmount <= 0.02 && contrastAmount <= 0.02) {
    return;
  }

  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  await yieldToMain();

  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const idx = row + x;
      const cLum = lum[idx];

      // Fine 3x3 Gaussian blur
      const fineBlur =
        (lum[idx - width - 1] +
          lum[idx - width] * 2 +
          lum[idx - width + 1] +
          lum[idx - 1] * 2 +
          cLum * 4 +
          lum[idx + 1] * 2 +
          lum[idx + width - 1] +
          lum[idx + width] * 2 +
          lum[idx + width + 1]) /
        16;

      // Medium 5x5 sparse ring average for texture band
      const medBlur =
        (fineBlur * 4 +
          lum[idx - width * 2] +
          lum[idx + width * 2] +
          lum[idx - 2] +
          lum[idx + 2] +
          lum[idx - width * 2 - 2] +
          lum[idx - width * 2 + 2] +
          lum[idx + width * 2 - 2] +
          lum[idx + width * 2 + 2]) /
        12;

      const fineBand = cLum - fineBlur;
      const texBand = fineBlur - medBlur;

      const absFine = Math.abs(fineBand);
      const fineGate = absFine < 1.5 ? 0 : Math.min(1, (absFine - 1.5) / 3.5);

      const absTex = Math.abs(texBand);
      const texGate = absTex < 2.2 ? 0 : Math.min(1, (absTex - 2.2) / 5.0);

      let delta = fineBand * fineAmount * fineGate + texBand * texAmount * texGate;

      if (contrastAmount > 0) {
        const norm = cLum / 255;
        delta +=
          (norm - 0.5) * (1 - Math.abs(norm - 0.5) * 2) * 30 * contrastAmount;
      }

      delta = Math.max(-32, Math.min(32, delta));

      if (delta !== 0) {
        const pIdx = idx * 4;
        const r = pixels[pIdx] + delta;
        const g = pixels[pIdx + 1] + delta;
        const b = pixels[pIdx + 2] + delta;
        pixels[pIdx] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
        pixels[pIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
        pixels[pIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
      }
    }

    if (y % 512 === 511) {
      await yieldToMain();
    }
  }
}

function canvasToPngDataUrlAndSize(
  canvas: HTMLCanvasElement
): Promise<{ dataUrl: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          const fallbackUrl = canvas.toDataURL('image/png');
          resolve({
            dataUrl: fallbackUrl,
            sizeBytes: Math.round((fallbackUrl.length * 3) / 4),
          });
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            dataUrl: reader.result as string,
            sizeBytes: blob.size,
          });
        };
        reader.onerror = () => reject(new Error('Failed to encode 5K PNG'));
        reader.readAsDataURL(blob);
      },
      'image/png',
      1.0
    );
  });
}

/**
 * Upscales an image to 5K (5120px on the longest dimension, preserving exact aspect ratio)
 * using Gemini AI content analysis, YCbCr chroma artifact suppression, anti-ringing Lanczos-3,
 * and dual-band luminance micro-detail enhancement.
 */
export async function upscaleImageTo5K(
  sourceDataUrl: string
): Promise<Upscale5KResult> {
  const img = await loadImage(sourceDataUrl);
  const srcW = img.naturalWidth || img.width || 800;
  const srcH = img.naturalHeight || img.height || 600;

  const longEdge = Math.max(srcW, srcH);
  const scaleFactor =
    longEdge >= TARGET_5K_LONG_EDGE ? 1 : TARGET_5K_LONG_EDGE / longEdge;
  const dstW = Math.max(1, Math.round(srcW * scaleFactor));
  const dstH = Math.max(1, Math.round(srcH * scaleFactor));

  const profile = await analyzeImageFor5KUpscale(img);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(img, 0, 0, srcW, srcH);
  const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);

  // Stage 1: YCbCr chroma artifact cleanup + edge-preserving luma denoise
  const denoised = applyChromaAndEdgeDenoise(
    srcImageData.data,
    srcW,
    srcH,
    profile.denoiseStrength,
    profile.chromaDenoise
  );
  await yieldToMain();

  // Stage 2: Separable Lanczos-3 resampling with anti-ringing clamping to 5K
  const upscaledPixels =
    dstW === srcW && dstH === srcH
      ? new Uint8ClampedArray(denoised)
      : await lanczos3Resample(
          denoised,
          srcW,
          srcH,
          dstW,
          dstH,
          profile.dehaloStrength
        );

  // Stage 3: Dual-band AI-guided luminance sharpening & texture clarity
  await applyDualBandLuminanceEnhancement(
    upscaledPixels,
    dstW,
    dstH,
    profile.edgeSharpness,
    profile.textureBoost,
    profile.microContrast
  );

  // Stage 4: Write 5K pixels to canvas and encode lossless PNG
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;
  const dstCtx = dstCanvas.getContext('2d')!;
  const outImageData = new ImageData(
    new Uint8ClampedArray(upscaledPixels),
    dstW,
    dstH
  );
  dstCtx.putImageData(outImageData, 0, 0);

  const { dataUrl, sizeBytes } = await canvasToPngDataUrlAndSize(dstCanvas);

  return {
    dataUrl,
    width: dstW,
    height: dstH,
    sizeBytes,
    profile,
  };
}
