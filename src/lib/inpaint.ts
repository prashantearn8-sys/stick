/**
 * Bottom-Right Gemini Sparkle Watermark Detection & Lossless Content-Aware Inpainting Engine
 * Specifically calibrated for the semi-transparent 4-pointed Gemini sparkle watermark
 * located in the bottom-right corner of Gemini AI-generated images (such as 16:9, 4:3, and 1:1 outputs).
 */

export interface WatermarkRegion {
  label: string;
  ymin: number; // 0-1000 normalized
  xmin: number; // 0-1000 normalized
  ymax: number; // 0-1000 normalized
  xmax: number; // 0-1000 normalized
}

export type ExportImageFormat = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Scans the bottom-right corner of a Gemini-generated image at pixel level to locate
 * the bright semi-transparent 4-pointed Gemini sparkle watermark and refine its tight bounding box.
 */
export async function refineBottomRightGeminiRegion(
  sourceDataUrl: string,
  hintRegions?: WatermarkRegion[]
): Promise<WatermarkRegion> {
  const img = await loadImage(sourceDataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  // Search window in bottom-right corner where Gemini places the 4-point sparkle:
  // x: [90.5% .. 99.0%], y: [88.5% .. 98.5%]
  const searchX0 = Math.floor(width * 0.905);
  const searchX1 = Math.floor(width * 0.99);
  const searchY0 = Math.floor(height * 0.885);
  const searchY1 = Math.floor(height * 0.985);

  const imgData = ctx.getImageData(0, 0, width, height).data;

  // Estimate expected sparkle radius based on image shortest dimension (~1.8% of min(width,height))
  const minDim = Math.min(width, height);
  const starRadius = Math.max(10, Math.round(minDim * 0.022));

  let bestScore = -Infinity;
  let bestCx = Math.round(width * 0.958);
  let bestCy = Math.round(height * 0.942);

  const step = Math.max(2, Math.floor(starRadius / 5));

  for (let cy = searchY0 + starRadius; cy <= searchY1 - starRadius; cy += step) {
    for (
      let cx = searchX0 + starRadius;
      cx <= searchX1 - starRadius;
      cx += step
    ) {
      // Compare average luminance inside the 4-point diamond/star core vs surrounding ring
      let coreLumSum = 0;
      let coreCount = 0;
      let ringLumSum = 0;
      let ringCount = 0;

      const coreR = Math.max(4, Math.floor(starRadius * 0.45));
      const ringR = Math.max(coreR + 4, Math.floor(starRadius * 0.95));

      for (let dy = -ringR; dy <= ringR; dy += 2) {
        for (let dx = -ringR; dx <= ringR; dx += 2) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          const idx = (py * width + px) * 4;
          const lum =
            0.299 * imgData[idx] +
            0.587 * imgData[idx + 1] +
            0.114 * imgData[idx + 2];

          // 4-point star metric: |dx| + |dy| (diamond/star shape)
          const manhattan = Math.abs(dx) + Math.abs(dy);
          if (manhattan <= coreR) {
            coreLumSum += lum;
            coreCount++;
          } else if (manhattan >= coreR * 1.4 && manhattan <= ringR * 1.25) {
            ringLumSum += lum;
            ringCount++;
          }
        }
      }

      if (coreCount > 0 && ringCount > 0) {
        const coreAvg = coreLumSum / coreCount;
        const ringAvg = ringLumSum / ringCount;
        const contrastDelta = coreAvg - ringAvg;
        // Gemini watermark is a semi-transparent white/light overlay (+8 to +95 luminance boost)
        if (contrastDelta > 5 && contrastDelta < 130 && contrastDelta > bestScore) {
          bestScore = contrastDelta;
          bestCx = cx;
          bestCy = cy;
        }
      }
    }
  }

  // If AI hint region is provided in the bottom-right corner and local contrast was weak, blend with AI hint
  if (bestScore < 5 && Array.isArray(hintRegions) && hintRegions.length > 0) {
    const h = hintRegions[0];
    if (h.xmin >= 880 && h.ymin >= 860) {
      return {
        label: 'Bottom-Right Gemini Sparkle',
        ymin: Math.max(875, Math.min(960, h.ymin)),
        xmin: Math.max(900, Math.min(970, h.xmin)),
        ymax: Math.max(930, Math.min(992, h.ymax)),
        xmax: Math.max(950, Math.min(994, h.xmax)),
      };
    }
  }

  const pad = Math.round(starRadius * 1.15);
  const xmin = Math.max(885, Math.round(((bestCx - pad) / width) * 1000));
  const xmax = Math.min(994, Math.round(((bestCx + pad) / width) * 1000));
  const ymin = Math.max(870, Math.round(((bestCy - pad) / height) * 1000));
  const ymax = Math.min(992, Math.round(((bestCy + pad) / height) * 1000));

  return {
    label: 'Bottom-Right Gemini Sparkle',
    ymin,
    xmin,
    ymax,
    xmax,
  };
}

/**
 * Performs precision content-aware inpainting strictly on the bottom-right Gemini sparkle watermark.
 * Uses artifact-free boundary marching without random noise so both illustrated artwork (like 039.jpg)
 * and photographic gradients are reconstructed seamlessly.
 */
export async function performContentAwareInpaint(
  sourceDataUrl: string,
  regions: WatermarkRegion[],
  _userMaskDataUrl?: string | null
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  // Refine the bottom-right Gemini sparkle bounding box on the actual image pixels
  const refinedRegion = await refineBottomRightGeminiRegion(
    sourceDataUrl,
    regions
  );

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Build binary mask of pixels to inpaint strictly inside the bottom-right Gemini sparkle region
  const mask = new Uint8Array(width * height);

  const x0 = Math.max(2, Math.floor((refinedRegion.xmin / 1000) * width));
  const y0 = Math.max(2, Math.floor((refinedRegion.ymin / 1000) * height));
  const x1 = Math.min(width - 3, Math.ceil((refinedRegion.xmax / 1000) * width));
  const y1 = Math.min(
    height - 3,
    Math.ceil((refinedRegion.ymax / 1000) * height)
  );

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(6, (x1 - x0) / 2);
  const ry = Math.max(6, (y1 - y0) / 2);

  // Sample clean perimeter pixels around the bounding box to estimate local background color & dark ink threshold
  let borderLumSum = 0;
  let borderCount = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) {
        const idx = (y * width + x) * 4;
        const lum =
          0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        borderLumSum += lum;
        borderCount++;
      }
    }
  }
  const avgBorderLum = borderCount > 0 ? borderLumSum / borderCount : 120;

  // Mask pixels inside the 4-pointed star / diamond envelope or elevated luminance pixels
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = Math.abs(x - cx) / rx;
      const ny = Math.abs(y - cy) / ry;
      // Astroid / 4-pointed Gemini sparkle curve: nx^0.65 + ny^0.65 <= 1.08
      const starMetric = Math.pow(nx, 0.68) + Math.pow(ny, 0.68);
      const pIdx = y * width + x;
      const cIdx = pIdx * 4;
      const lum =
        0.299 * data[cIdx] +
        0.587 * data[cIdx + 1] +
        0.114 * data[cIdx + 2];

      if (starMetric <= 1.05 || (nx + ny <= 1.25 && lum > avgBorderLum + 6)) {
        mask[pIdx] = 1;
      }
    }
  }

  // Dilate mask by 2px within the bounding box to remove anti-aliased sparkle edges
  const dilated = new Uint8Array(mask);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1) {
        dilated[idx - 1] = 1;
        dilated[idx + 1] = 1;
        dilated[idx - width] = 1;
        dilated[idx + width] = 1;
        dilated[idx - width - 1] = 1;
        dilated[idx + width + 1] = 1;
      }
    }
  }

  // Iterative inward boundary marching with directional structure preservation
  // (continues crisp lines/edges and smooth gradients cleanly across the 4-point sparkle)
  const state = new Uint8Array(dilated);
  const maxPasses = 72;

  for (let pass = 0; pass < maxPasses; pass++) {
    const boundaryPixels: number[] = [];

    for (let y = y0 - 2; y <= y1 + 2; y++) {
      if (y <= 1 || y >= height - 1) continue;
      for (let x = x0 - 2; x <= x1 + 2; x++) {
        if (x <= 1 || x >= width - 1) continue;
        const idx = y * width + x;
        if (state[idx] === 1) {
          if (
            state[idx - 1] === 0 ||
            state[idx + 1] === 0 ||
            state[idx - width] === 0 ||
            state[idx + width] === 0
          ) {
            boundaryPixels.push(idx);
          }
        }
      }
    }

    if (boundaryPixels.length === 0) break;

    for (const idx of boundaryPixels) {
      const y = Math.floor(idx / width);
      const x = idx % width;
      let wSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      // Estimate local gradient around known neighbor ring to preserve crisp edges
      let gradX = 0;
      let gradY = 0;
      if (x > 1 && x < width - 2 && y > 1 && y < height - 2) {
        const lIdx = (y * width + (x - 1)) * 4;
        const rIdx = (y * width + (x + 1)) * 4;
        const uIdx = ((y - 1) * width + x) * 4;
        const dIdx = ((y + 1) * width + x) * 4;
        const lumL = 0.299 * data[lIdx] + 0.587 * data[lIdx + 1] + 0.114 * data[lIdx + 2];
        const lumR = 0.299 * data[rIdx] + 0.587 * data[rIdx + 1] + 0.114 * data[rIdx + 2];
        const lumU = 0.299 * data[uIdx] + 0.587 * data[uIdx + 1] + 0.114 * data[uIdx + 2];
        const lumD = 0.299 * data[dIdx] + 0.587 * data[dIdx + 1] + 0.114 * data[dIdx + 2];
        gradX = (lumR - lumL) * 0.5;
        gradY = (lumD - lumU) * 0.5;
      }
      const gradMag = Math.hypot(gradX, gradY) + 1e-4;
      // Tangent vector perpendicular to gradient (direction along edges/lines)
      const tanX = -gradY / gradMag;
      const tanY = gradX / gradMag;

      const radius = 6;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (state[nIdx] === 0) {
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            // Boost weight along local edge tangent so lines bridge cleanly
            const dirDot = Math.abs((dx / dist) * tanX + (dy / dist) * tanY);
            const directionalFactor = gradMag > 8 ? 0.45 + 1.25 * dirDot : 1.0;
            const weight = directionalFactor / (distSq * dist);
            const cIdx = nIdx * 4;
            rSum += data[cIdx] * weight;
            gSum += data[cIdx + 1] * weight;
            bSum += data[cIdx + 2] * weight;
            wSum += weight;
          }
        }
      }

      if (wSum > 0) {
        const cIdx = idx * 4;
        data[cIdx] = Math.min(255, Math.max(0, Math.round(rSum / wSum)));
        data[cIdx + 1] = Math.min(255, Math.max(0, Math.round(gSum / wSum)));
        data[cIdx + 2] = Math.min(255, Math.max(0, Math.round(bSum / wSum)));
      }
    }

    for (const idx of boundaryPixels) {
      state[idx] = 0;
    }
  }

  // Gentle edge-preserving feather pass strictly inside the inpainted sparkle mask
  for (let iter = 0; iter < 4; iter++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * width + x;
        if (dilated[idx] === 1) {
          const cIdx = idx * 4;
          const l = (idx - 1) * 4;
          const r = (idx + 1) * 4;
          const u = (idx - width) * 4;
          const d = (idx + width) * 4;
          data[cIdx] = Math.round(
            data[cIdx] * 0.6 +
              (data[l] + data[r] + data[u] + data[d]) * 0.1
          );
          data[cIdx + 1] = Math.round(
            data[cIdx + 1] * 0.6 +
              (data[l + 1] + data[r + 1] + data[u + 1] + data[d + 1]) * 0.1
          );
          data[cIdx + 2] = Math.round(
            data[cIdx + 2] * 0.6 +
              (data[l + 2] + data[r + 2] + data[u + 2] + data[d + 2]) * 0.1
          );
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Converts any image DataURL into the target export image format (Lossless PNG at 100% quality)
 * and produces both a base64 DataURL and a binary Blob for reliable browser downloading.
 */
export async function convertImageForExport(
  sourceDataUrl: string,
  format: ExportImageFormat = 'image/png',
  quality = 1.0
): Promise<{ dataUrl: string; blob: Blob; extension: string }> {
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 800;
  canvas.height = img.naturalHeight || img.height || 600;
  const ctx = canvas.getContext('2d')!;

  if (format === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  const extension =
    format === 'image/png'
      ? 'png'
      : format === 'image/webp'
      ? 'webp'
      : 'jpg';

  const dataUrl = canvas.toDataURL(format, quality);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (b) => {
        if (b) {
          resolve(b);
        } else {
          const base64 = dataUrl.split(',')[1] || '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          resolve(new Blob([bytes], { type: format }));
        }
      },
      format,
      quality
    );
  });

  return {
    dataUrl,
    blob,
    extension,
  };
}

/**
 * Triggers a reliable client-side browser download using a binary Blob URL
 */
export function triggerBlobDownload(blob: Blob, fileName: string): string {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return blobUrl;
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
