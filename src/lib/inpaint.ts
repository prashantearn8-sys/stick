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

export interface InpaintAIOptions {
  backgroundStyle?: string;
  sparklePolarity?: 'bright' | 'dark';
  estimatedOpacity?: number;
}

export interface CornerCropPayload {
  cornerCropBase64: string;
  cornerMimeType: string;
  cropBounds: { xmin: number; ymin: number; xmax: number; ymax: number };
}

/**
 * Extracts a zoomed bottom-right 20%x20% corner crop (up to 512px) so Gemini AI
 * inspects the bottom-right sparkle watermark at 5x higher spatial precision.
 */
export async function extractBottomRightCornerCrop(
  sourceDataUrl: string
): Promise<CornerCropPayload> {
  const img = await loadImage(sourceDataUrl);
  const width = img.naturalWidth || img.width || 800;
  const height = img.naturalHeight || img.height || 600;

  const cropX0 = Math.floor(width * 0.8);
  const cropY0 = Math.floor(height * 0.8);
  const cropW = Math.max(1, width - cropX0);
  const cropH = Math.max(1, height - cropY0);

  const maxOut = 512;
  const scale = Math.min(2, maxOut / Math.max(cropW, cropH));
  const outW = Math.max(32, Math.round(cropW * scale));
  const outH = Math.max(32, Math.round(cropH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cropX0, cropY0, cropW, cropH, 0, 0, outW, outH);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return {
    cornerCropBase64: dataUrl.split(',')[1] || '',
    cornerMimeType: 'image/jpeg',
    cropBounds: { xmin: 800, ymin: 800, xmax: 1000, ymax: 1000 },
  };
}

/**
 * Scans the bottom-right corner of a Gemini-generated image at pixel level to locate
 * the semi-transparent 4-pointed Gemini sparkle watermark (bright or dark) using axial
 * star-arm correlation and refine its tight bounding box.
 */
export async function refineBottomRightGeminiRegion(
  sourceDataUrl: string,
  hintRegions?: WatermarkRegion[]
): Promise<WatermarkRegion> {
  const img = await loadImage(sourceDataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  // Search window in bottom-right corner where Gemini places the 4-point sparkle:
  // x: [90.5% .. 99.0%], y: [88.5% .. 98.5%]
  const searchX0 = Math.max(0, Math.floor(width * 0.905));
  const searchX1 = Math.min(width, Math.ceil(width * 0.99));
  const searchY0 = Math.max(0, Math.floor(height * 0.885));
  const searchY1 = Math.min(height, Math.ceil(height * 0.985));
  const searchW = Math.max(1, searchX1 - searchX0);
  const searchH = Math.max(1, searchY1 - searchY0);

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = searchW;
  roiCanvas.height = searchH;
  const roiCtx = roiCanvas.getContext('2d')!;
  roiCtx.drawImage(
    img,
    searchX0,
    searchY0,
    searchW,
    searchH,
    0,
    0,
    searchW,
    searchH
  );
  const roiData = roiCtx.getImageData(0, 0, searchW, searchH).data;

  const minDim = Math.min(width, height);
  const starRadius = Math.max(10, Math.round(minDim * 0.022));

  let bestScore = -Infinity;
  let bestCx = Math.round(width * 0.958);
  let bestCy = Math.round(height * 0.942);

  const step = Math.max(2, Math.floor(starRadius / 5));

  for (
    let localCy = starRadius;
    localCy <= searchH - starRadius;
    localCy += step
  ) {
    for (
      let localCx = starRadius;
      localCx <= searchW - starRadius;
      localCx += step
    ) {
      let coreLumSum = 0;
      let coreCount = 0;
      let armLumSum = 0;
      let armCount = 0;
      let ringLumSum = 0;
      let ringCount = 0;

      const coreR = Math.max(4, Math.floor(starRadius * 0.42));
      const ringR = Math.max(coreR + 4, Math.floor(starRadius * 0.95));

      for (let dy = -ringR; dy <= ringR; dy += 2) {
        const py = localCy + dy;
        if (py < 0 || py >= searchH) continue;
        for (let dx = -ringR; dx <= ringR; dx += 2) {
          const px = localCx + dx;
          if (px < 0 || px >= searchW) continue;
          const idx = (py * searchW + px) * 4;
          const lum =
            0.299 * roiData[idx] +
            0.587 * roiData[idx + 1] +
            0.114 * roiData[idx + 2];

          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const manhattan = absX + absY;

          if (manhattan <= coreR) {
            coreLumSum += lum;
            coreCount++;
          } else if (
            (absX <= 2 || absY <= 2) &&
            manhattan <= starRadius * 0.9
          ) {
            armLumSum += lum;
            armCount++;
          } else if (manhattan >= coreR * 1.4 && manhattan <= ringR * 1.25) {
            ringLumSum += lum;
            ringCount++;
          }
        }
      }

      if (coreCount > 0 && ringCount > 0) {
        const coreAvg = coreLumSum / coreCount;
        const ringAvg = ringLumSum / ringCount;
        const armAvg = armCount > 0 ? armLumSum / armCount : coreAvg;
        const coreContrast = Math.abs(coreAvg - ringAvg);
        const armAlignment =
          Math.sign(coreAvg - ringAvg) * (armAvg - ringAvg);
        const totalScore = coreContrast + Math.max(0, armAlignment * 0.5);

        if (coreContrast > 4 && coreContrast < 145 && totalScore > bestScore) {
          bestScore = totalScore;
          bestCx = searchX0 + localCx;
          bestCy = searchY0 + localCy;
        }
      }
    }
  }

  // Blend with AI hint if AI located a tight box in the bottom-right corner and pixel signal was subtle
  if (bestScore < 7 && Array.isArray(hintRegions) && hintRegions.length > 0) {
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
 * Performs AI-guided structure + exemplar texture reconstruction strictly on the bottom-right
 * Gemini sparkle watermark inside a tight ROI crop for fast execution and zero damage to artwork.
 */
export async function performContentAwareInpaint(
  sourceDataUrl: string,
  regions: WatermarkRegion[],
  _userMaskDataUrl?: string | null,
  aiOptions?: InpaintAIOptions
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  const refinedRegion = await refineBottomRightGeminiRegion(
    sourceDataUrl,
    regions
  );

  const absX0 = Math.max(2, Math.floor((refinedRegion.xmin / 1000) * width));
  const absY0 = Math.max(2, Math.floor((refinedRegion.ymin / 1000) * height));
  const absX1 = Math.min(
    width - 3,
    Math.ceil((refinedRegion.xmax / 1000) * width)
  );
  const absY1 = Math.min(
    height - 3,
    Math.ceil((refinedRegion.ymax / 1000) * height)
  );

  // Extract a tight ROI with 14px margin so clean exemplar texture patches surround the sparkle
  const margin = 14;
  const roiX0 = Math.max(0, absX0 - margin);
  const roiY0 = Math.max(0, absY0 - margin);
  const roiX1 = Math.min(width - 1, absX1 + margin);
  const roiY1 = Math.min(height - 1, absY1 + margin);
  const roiW = Math.max(12, roiX1 - roiX0 + 1);
  const roiH = Math.max(12, roiY1 - roiY0 + 1);

  const imgData = ctx.getImageData(roiX0, roiY0, roiW, roiH);
  const data = imgData.data;
  const mask = new Uint8Array(roiW * roiH);

  const x0 = absX0 - roiX0;
  const y0 = absY0 - roiY0;
  const x1 = absX1 - roiX0;
  const y1 = absY1 - roiY0;

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(6, (x1 - x0) / 2);
  const ry = Math.max(6, (y1 - y0) / 2);

  // Sample clean perimeter pixels around the bounding box
  let borderLumSum = 0;
  let borderCount = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) {
        const idx = (y * roiW + x) * 4;
        const lum =
          0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        borderLumSum += lum;
        borderCount++;
      }
    }
  }
  const avgBorderLum = borderCount > 0 ? borderLumSum / borderCount : 120;
  const isDarkPolarity = aiOptions?.sparklePolarity === 'dark';

  // Polarity-aware 4-pointed star envelope masking
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = Math.abs(x - cx) / rx;
      const ny = Math.abs(y - cy) / ry;
      const starMetric = Math.pow(nx, 0.66) + Math.pow(ny, 0.66);
      const pIdx = y * roiW + x;
      const cIdx = pIdx * 4;
      const lum =
        0.299 * data[cIdx] +
        0.587 * data[cIdx + 1] +
        0.114 * data[cIdx + 2];

      const lumDeviates = isDarkPolarity
        ? lum < avgBorderLum - 5
        : lum > avgBorderLum + 5;

      if (starMetric <= 1.04 || (nx + ny <= 1.25 && lumDeviates)) {
        mask[pIdx] = 1;
      }
    }
  }

  // Dilate mask by 2px inside the ROI to remove anti-aliased sparkle edges
  const dilated = new Uint8Array(mask);
  for (let y = Math.max(1, y0); y <= Math.min(roiH - 2, y1); y++) {
    for (let x = Math.max(1, x0); x <= Math.min(roiW - 2, x1); x++) {
      const idx = y * roiW + x;
      if (mask[idx] === 1) {
        dilated[idx - 1] = 1;
        dilated[idx + 1] = 1;
        dilated[idx - roiW] = 1;
        dilated[idx + roiW] = 1;
        dilated[idx - roiW - 1] = 1;
        dilated[idx + roiW + 1] = 1;
      }
    }
  }

  // Stage 1: Directional Gradient-Tangent Boundary Marching (Structure Continuation)
  const state = new Uint8Array(dilated);
  const maxPasses = 72;

  for (let pass = 0; pass < maxPasses; pass++) {
    const boundaryPixels: number[] = [];

    for (let y = Math.max(1, y0 - 2); y <= Math.min(roiH - 2, y1 + 2); y++) {
      for (let x = Math.max(1, x0 - 2); x <= Math.min(roiW - 2, x1 + 2); x++) {
        const idx = y * roiW + x;
        if (state[idx] === 1) {
          if (
            state[idx - 1] === 0 ||
            state[idx + 1] === 0 ||
            state[idx - roiW] === 0 ||
            state[idx + roiW] === 0
          ) {
            boundaryPixels.push(idx);
          }
        }
      }
    }

    if (boundaryPixels.length === 0) break;

    for (const idx of boundaryPixels) {
      const y = Math.floor(idx / roiW);
      const x = idx % roiW;
      let wSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      let gradX = 0;
      let gradY = 0;
      if (x > 1 && x < roiW - 2 && y > 1 && y < roiH - 2) {
        const lIdx = (y * roiW + (x - 1)) * 4;
        const rIdx = (y * roiW + (x + 1)) * 4;
        const uIdx = ((y - 1) * roiW + x) * 4;
        const dIdx = ((y + 1) * roiW + x) * 4;
        const lumL =
          0.299 * data[lIdx] + 0.587 * data[lIdx + 1] + 0.114 * data[lIdx + 2];
        const lumR =
          0.299 * data[rIdx] + 0.587 * data[rIdx + 1] + 0.114 * data[rIdx + 2];
        const lumU =
          0.299 * data[uIdx] + 0.587 * data[uIdx + 1] + 0.114 * data[uIdx + 2];
        const lumD =
          0.299 * data[dIdx] + 0.587 * data[dIdx + 1] + 0.114 * data[dIdx + 2];
        gradX = (lumR - lumL) * 0.5;
        gradY = (lumD - lumU) * 0.5;
      }
      const gradMag = Math.hypot(gradX, gradY) + 1e-4;
      const tanX = -gradY / gradMag;
      const tanY = gradX / gradMag;

      const radius = 6;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= roiH) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= roiW) continue;
          const nIdx = ny * roiW + nx;
          if (state[nIdx] === 0) {
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            const dirDot = Math.abs((dx / dist) * tanX + (dy / dist) * tanY);
            const directionalFactor = gradMag > 7 ? 0.35 + 1.45 * dirDot : 1.0;
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

  // Stage 2: Exemplar Patch-Match High-Frequency Texture Transfer
  // Transfers realistic grain/texture from clean border neighborhoods onto the smooth diffusion fill
  const style = aiOptions?.backgroundStyle || 'textured';
  if (style !== 'solid') {
    const cleanDonors: { dx: number; dy: number }[] = [];
    for (let y = 3; y < roiH - 3; y += 2) {
      for (let x = 3; x < roiW - 3; x += 2) {
        let hasMasked = false;
        for (let py = -2; py <= 2 && !hasMasked; py++) {
          for (let px = -2; px <= 2; px++) {
            if (dilated[(y + py) * roiW + (x + px)] === 1) {
              hasMasked = true;
              break;
            }
          }
        }
        if (!hasMasked) {
          cleanDonors.push({ dx: x, dy: y });
        }
      }
    }

    if (cleanDonors.length > 0) {
      const textureOverlay = new Float32Array(roiW * roiH * 3);
      const textureWeight = new Float32Array(roiW * roiH);

      for (let y = Math.max(2, y0); y <= Math.min(roiH - 3, y1); y += 2) {
        for (let x = Math.max(2, x0); x <= Math.min(roiW - 3, x1); x += 2) {
          if (dilated[y * roiW + x] !== 1) continue;

          // Find best-matching clean 5x5 donor patch by SSD against the diffused structure
          let bestDonor = cleanDonors[0];
          let bestSsd = Infinity;

          for (let d = 0; d < cleanDonors.length; d++) {
            const cand = cleanDonors[d];
            let ssd = 0;
            for (let py = -2; py <= 2; py += 2) {
              for (let px = -2; px <= 2; px += 2) {
                const tIdx = ((y + py) * roiW + (x + px)) * 4;
                const sIdx = ((cand.dy + py) * roiW + (cand.dx + px)) * 4;
                const dr = data[tIdx] - data[sIdx];
                const dg = data[tIdx + 1] - data[sIdx + 1];
                const db = data[tIdx + 2] - data[sIdx + 2];
                ssd += dr * dr + dg * dg + db * db;
              }
            }
            if (ssd < bestSsd) {
              bestSsd = ssd;
              bestDonor = cand;
            }
          }

          // Blend high-frequency texture residual from donor patch center (preserving base structure)
          const donorMeanR =
            (data[((bestDonor.dy - 1) * roiW + bestDonor.dx) * 4] +
              data[((bestDonor.dy + 1) * roiW + bestDonor.dx) * 4] +
              data[(bestDonor.dy * roiW + bestDonor.dx - 1) * 4] +
              data[(bestDonor.dy * roiW + bestDonor.dx + 1) * 4]) *
            0.25;
          const donorMeanG =
            (data[((bestDonor.dy - 1) * roiW + bestDonor.dx) * 4 + 1] +
              data[((bestDonor.dy + 1) * roiW + bestDonor.dx) * 4 + 1] +
              data[(bestDonor.dy * roiW + bestDonor.dx - 1) * 4 + 1] +
              data[(bestDonor.dy * roiW + bestDonor.dx + 1) * 4 + 1]) *
            0.25;
          const donorMeanB =
            (data[((bestDonor.dy - 1) * roiW + bestDonor.dx) * 4 + 2] +
              data[((bestDonor.dy + 1) * roiW + bestDonor.dx) * 4 + 2] +
              data[(bestDonor.dy * roiW + bestDonor.dx - 1) * 4 + 2] +
              data[(bestDonor.dy * roiW + bestDonor.dx + 1) * 4 + 2]) *
            0.25;

          for (let py = -1; py <= 1; py++) {
            for (let px = -1; px <= 1; px++) {
              const pIdx = (y + py) * roiW + (x + px);
              if (dilated[pIdx] !== 1) continue;
              const sIdx = ((bestDonor.dy + py) * roiW + (bestDonor.dx + px)) * 4;
              const t3 = pIdx * 3;
              textureOverlay[t3] += data[sIdx] - donorMeanR;
              textureOverlay[t3 + 1] += data[sIdx + 1] - donorMeanG;
              textureOverlay[t3 + 2] += data[sIdx + 2] - donorMeanB;
              textureWeight[pIdx] += 1;
            }
          }
        }
      }

      const blendStrength = style === 'gradient' ? 0.45 : 0.8;
      for (let y = Math.max(1, y0); y <= Math.min(roiH - 2, y1); y++) {
        for (let x = Math.max(1, x0); x <= Math.min(roiW - 2, x1); x++) {
          const pIdx = y * roiW + x;
          const w = textureWeight[pIdx];
          if (w > 0) {
            const cIdx = pIdx * 4;
            const t3 = pIdx * 3;
            const r = data[cIdx] + (textureOverlay[t3] / w) * blendStrength;
            const g =
              data[cIdx + 1] + (textureOverlay[t3 + 1] / w) * blendStrength;
            const b =
              data[cIdx + 2] + (textureOverlay[t3 + 2] / w) * blendStrength;
            data[cIdx] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
            data[cIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
            data[cIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
          }
        }
      }
    }
  }

  // Stage 3: Gentle 2-pass seam smoothing strictly inside the dilated sparkle boundary
  for (let iter = 0; iter < 2; iter++) {
    for (let y = Math.max(1, y0); y <= Math.min(roiH - 2, y1); y++) {
      for (let x = Math.max(1, x0); x <= Math.min(roiW - 2, x1); x++) {
        const idx = y * roiW + x;
        if (dilated[idx] === 1) {
          const cIdx = idx * 4;
          const l = (idx - 1) * 4;
          const r = (idx + 1) * 4;
          const u = (idx - roiW) * 4;
          const d = (idx + roiW) * 4;
          data[cIdx] = Math.round(
            data[cIdx] * 0.72 + (data[l] + data[r] + data[u] + data[d]) * 0.07
          );
          data[cIdx + 1] = Math.round(
            data[cIdx + 1] * 0.72 +
              (data[l + 1] + data[r + 1] + data[u + 1] + data[d + 1]) * 0.07
          );
          data[cIdx + 2] = Math.round(
            data[cIdx + 2] * 0.72 +
              (data[l + 2] + data[r + 2] + data[u + 2] + data[d + 2]) * 0.07
          );
        }
      }
    }
  }

  ctx.putImageData(imgData, roiX0, roiY0);
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
  if (
    format === 'image/png' &&
    sourceDataUrl.startsWith('data:image/png;base64,')
  ) {
    const base64 = sourceDataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return {
      dataUrl: sourceDataUrl,
      blob: new Blob([bytes], { type: 'image/png' }),
      extension: 'png',
    };
  }

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
