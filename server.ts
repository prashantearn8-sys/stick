import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenAI,
  Type,
  GenerateContentResponse,
  ThinkingLevel,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Clamp any AI-detected region strictly to the bottom-right Gemini sparkle watermark zone
// so the rest of the artwork/image is never touched.
function clampToBottomRightGeminiZone(regions: any[]): {
  label: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}[] {
  const defaultBottomRight = {
    label: 'Bottom-Right Gemini Sparkle',
    ymin: 905,
    xmin: 932,
    ymax: 974,
    xmax: 982,
  };

  if (!Array.isArray(regions) || regions.length === 0) {
    return [defaultBottomRight];
  }

  // Filter to regions in the bottom-right corner (xmin >= 840, ymin >= 820)
  const bottomRightCandidates = regions.filter(
    (r) =>
      typeof r?.xmin === 'number' &&
      typeof r?.ymin === 'number' &&
      r.xmax >= 860 &&
      r.ymax >= 840
  );

  if (bottomRightCandidates.length === 0) {
    return [defaultBottomRight];
  }

  const r = bottomRightCandidates[0];
  const xmin = Math.max(885, Math.min(965, Math.round(r.xmin)));
  const ymin = Math.max(870, Math.min(955, Math.round(r.ymin)));
  const xmax = Math.max(xmin + 18, Math.min(994, Math.round(r.xmax)));
  const ymax = Math.max(ymin + 22, Math.min(992, Math.round(r.ymax)));

  return [
    {
      label: 'Bottom-Right Gemini Sparkle',
      ymin,
      xmin,
      ymax,
      xmax,
    },
  ];
}

interface CropBounds {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

function mapCropRegionsToFullFrame(
  regions: any[],
  cropBounds?: CropBounds
): any[] {
  if (
    !cropBounds ||
    typeof cropBounds.xmin !== 'number' ||
    typeof cropBounds.ymin !== 'number' ||
    typeof cropBounds.xmax !== 'number' ||
    typeof cropBounds.ymax !== 'number'
  ) {
    return regions;
  }
  const cropW = Math.max(1, cropBounds.xmax - cropBounds.xmin);
  const cropH = Math.max(1, cropBounds.ymax - cropBounds.ymin);
  if (!Array.isArray(regions)) return [];
  return regions.map((r) => ({
    ...r,
    xmin: Math.round(cropBounds.xmin + ((r?.xmin ?? 500) / 1000) * cropW),
    xmax: Math.round(cropBounds.xmin + ((r?.xmax ?? 850) / 1000) * cropW),
    ymin: Math.round(cropBounds.ymin + ((r?.ymin ?? 500) / 1000) * cropH),
    ymax: Math.round(cropBounds.ymin + ((r?.ymax ?? 850) / 1000) * cropH),
  }));
}

const watermarkAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    hasWatermark: {
      type: Type.BOOLEAN,
      description:
        'True if the bottom-right Gemini four-point sparkle star watermark is present.',
    },
    watermarkCount: {
      type: Type.INTEGER,
      description: '1 if the bottom-right Gemini sparkle watermark is visible, else 0.',
    },
    watermarkType: {
      type: Type.STRING,
      description:
        'Description of the bottom-right Gemini sparkle watermark (e.g., Bottom-Right Gemini 4-Point Sparkle).',
    },
    backgroundStyle: {
      type: Type.STRING,
      description:
        'Background texture directly behind the sparkle: solid, gradient, textured, line_art, or photo.',
    },
    sparklePolarity: {
      type: Type.STRING,
      description:
        'bright if the sparkle is lighter than surrounding pixels, or dark if inverted/darker.',
    },
    estimatedOpacity: {
      type: Type.INTEGER,
      description:
        'Estimated opacity percentage of the bottom-right Gemini sparkle from 0 to 100.',
    },
    restorationStrategy: {
      type: Type.STRING,
      description:
        'Technical strategy to remove only the bottom-right Gemini sparkle star while preserving surrounding texture and lines.',
    },
    regions: {
      type: Type.ARRAY,
      description:
        'Single tight bounding box strictly around the four-pointed Gemini sparkle icon in 0-1000 normalized coordinates relative to the provided image/crop.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description: 'Always "Bottom-Right Gemini Sparkle".',
          },
          ymin: { type: Type.INTEGER },
          xmin: { type: Type.INTEGER },
          ymax: { type: Type.INTEGER },
          xmax: { type: Type.INTEGER },
        },
      },
    },
  },
};

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

  // Endpoint 1: Bottom-Right Gemini Watermark Detection (Zoomed Corner Crop + gemini-4-hydrogen)
  app.post('/api/watermark/detect', async (req, res) => {
    try {
      const { imageBase64, mimeType, cornerCropBase64, cornerMimeType, cropBounds } =
        req.body;
      const targetBase64 = cornerCropBase64 || imageBase64;
      const targetMime = cornerMimeType || mimeType;
      if (!targetBase64 || !targetMime) {
        res.status(400).json({ error: 'Missing imageBase64 or mimeType' });
        return;
      }

      const isCropped = Boolean(cornerCropBase64 && cropBounds);
      const ai = getGenAIClient();
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: targetMime,
                data: targetBase64,
              },
            },
            {
              text: isCropped
                ? 'This is a 5x zoomed crop of the bottom-right corner of a Gemini-generated image. ' +
                  'Locate the 4-pointed Gemini sparkle/star watermark in this corner crop, classify the backgroundStyle behind it (solid, gradient, textured, line_art, or photo) and sparklePolarity (bright or dark), and return a single tight 0-1000 normalized bounding box around ONLY the sparkle icon within this crop.'
                : 'Focus EXCLUSIVELY on the bottom-right corner of this Gemini-generated image (normalized x: 880 to 995, y: 860 to 995). ' +
                  'Locate the small semi-transparent 4-pointed Gemini sparkle/star watermark, classify backgroundStyle and sparklePolarity, and return a single tight 0-1000 normalized bounding box around ONLY the sparkle icon.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: watermarkAnalysisSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const mappedRegions = isCropped
        ? mapCropRegionsToFullFrame(parsed.regions || [], cropBounds)
        : parsed.regions || [];
      const clampedRegions = clampToBottomRightGeminiZone(mappedRegions);

      res.json({
        hasWatermark:
          typeof parsed.hasWatermark === 'boolean' ? parsed.hasWatermark : true,
        watermarkCount: 1,
        watermarkType:
          parsed.watermarkType || 'Bottom-Right Gemini 4-Point Sparkle',
        backgroundStyle: parsed.backgroundStyle || 'textured',
        sparklePolarity: parsed.sparklePolarity === 'dark' ? 'dark' : 'bright',
        estimatedOpacity:
          typeof parsed.estimatedOpacity === 'number'
            ? parsed.estimatedOpacity
            : 55,
        restorationStrategy:
          parsed.restorationStrategy ||
          'AI-guided sparkle isolation with directional isophote & exemplar texture reconstruction',
        regions: clampedRegions,
      });
    } catch (_error: any) {
      res.json({
        hasWatermark: true,
        watermarkCount: 1,
        watermarkType: 'Bottom-Right Gemini 4-Point Sparkle',
        backgroundStyle: 'textured',
        sparklePolarity: 'bright',
        estimatedOpacity: 55,
        restorationStrategy:
          'AI-guided sparkle isolation with directional isophote & exemplar texture reconstruction',
        regions: clampToBottomRightGeminiZone([]),
      });
    }
  });

  // Endpoint 2: Bottom-Right Gemini Watermark Removal Guidance (Zoomed Corner Crop + gemini-4-hydrogen)
  app.post('/api/watermark/restore', async (req, res) => {
    try {
      const {
        imageBase64,
        mimeType,
        cornerCropBase64,
        cornerMimeType,
        cropBounds,
        detectedRegions = [],
      } = req.body;

      const targetBase64 = cornerCropBase64 || imageBase64;
      const targetMime = cornerMimeType || mimeType;
      if (!targetBase64 || !targetMime) {
        res.status(400).json({ error: 'Missing imageBase64 or mimeType' });
        return;
      }

      const isCropped = Boolean(cornerCropBase64 && cropBounds);
      const ai = getGenAIClient();
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                data: targetBase64,
                mimeType: targetMime,
              },
            },
            {
              text: isCropped
                ? 'This is a 5x zoomed crop of the bottom-right corner of an image. ' +
                  'Return the exact tight normalized bounding box (0-1000 relative to this crop) of the 4-pointed Gemini sparkle watermark, plus backgroundStyle (solid, gradient, textured, line_art, or photo), sparklePolarity (bright or dark), and estimatedOpacity (0-100) so our reconstruction engine removes only that sparkle seamlessly.'
                : 'Inspect ONLY the bottom-right corner of this Gemini-generated image (normalized x: 880 to 995, y: 860 to 995) and return the exact tight normalized bounding box (0-1000) of the 4-pointed Gemini sparkle watermark, backgroundStyle, and sparklePolarity so our reconstruction engine removes only that bottom-right sparkle seamlessly.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: watermarkAnalysisSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const mappedRegions = isCropped
        ? mapCropRegionsToFullFrame(parsed.regions || [], cropBounds)
        : parsed.regions || [];
      const finalRegions = clampToBottomRightGeminiZone(
        Array.isArray(mappedRegions) && mappedRegions.length > 0
          ? mappedRegions
          : detectedRegions
      );

      res.json({
        modelUsed: 'gemini-4-hydrogen',
        regions: finalRegions,
        watermarkType:
          parsed.watermarkType || 'Bottom-Right Gemini 4-Point Sparkle',
        backgroundStyle: parsed.backgroundStyle || 'textured',
        sparklePolarity: parsed.sparklePolarity === 'dark' ? 'dark' : 'bright',
        estimatedOpacity:
          typeof parsed.estimatedOpacity === 'number'
            ? parsed.estimatedOpacity
            : 55,
        restorationStrategy:
          parsed.restorationStrategy ||
          'AI-guided sparkle isolation with directional isophote & exemplar texture reconstruction',
      });
    } catch (_error: any) {
      res.json({
        modelUsed: 'gemini-4-hydrogen',
        regions: clampToBottomRightGeminiZone(req.body?.detectedRegions || []),
        watermarkType: 'Bottom-Right Gemini 4-Point Sparkle',
        backgroundStyle: 'textured',
        sparklePolarity: 'bright',
        estimatedOpacity: 55,
        restorationStrategy:
          'AI-guided sparkle isolation with directional isophote & exemplar texture reconstruction',
      });
    }
  });

  // Endpoint 2B: 5K AI Upscaler Image Content Profile Analysis (Free-tier gemini-4-hydrogen)
  const upscaleAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
      contentCategory: {
        type: Type.STRING,
        description:
          'One of: photo, portrait, illustration, anime_lineart, text_ui, mixed',
      },
      denoiseStrength: {
        type: Type.INTEGER,
        description:
          'Recommended edge-preserving luma denoise strength 0-100 prior to 5K upscaling (higher for noisy/grainy JPEGs, lower for crisp digital art).',
      },
      chromaDenoise: {
        type: Type.INTEGER,
        description:
          'Recommended YCbCr chroma artifact & color-blotch suppression 0-100 (high for JPEG-compressed photos, low for clean lossless PNGs).',
      },
      edgeSharpness: {
        type: Type.INTEGER,
        description:
          'Recommended fine-edge luminance sharpening 0-100 for 5K super-resolution.',
      },
      textureBoost: {
        type: Type.INTEGER,
        description:
          'Recommended medium-band micro-texture clarity boost 0-100 at 5K.',
      },
      microContrast: {
        type: Type.INTEGER,
        description:
          'Recommended local midtone clarity 0-100 at 5K.',
      },
      dehaloStrength: {
        type: Type.INTEGER,
        description:
          'Recommended anti-ringing/dehalo strength 0-100 to keep high-contrast edges clean without halos.',
      },
      upscaleNotes: {
        type: Type.STRING,
        description:
          'Short 1-sentence summary of the detected image characteristics and applied 5K AI tuning.',
      },
    },
  };

  app.post('/api/upscale/analyze', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64 || !mimeType) {
        res.status(400).json({ error: 'Missing imageBase64 or mimeType' });
        return;
      }

      const ai = getGenAIClient();
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType,
              },
            },
            {
              text:
                'Inspect this image closely for 5K (5120px) AI super-resolution upscaling. ' +
                'Classify its contentCategory (photo, portrait, illustration, anime_lineart, text_ui, or mixed) and choose precise tuning 0-100 for denoiseStrength, chromaDenoise, edgeSharpness, textureBoost, microContrast, and dehaloStrength so fine detail (hair, skin, textures, line art, text) is maximized at 5K with zero JPEG ringing or color blotching.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: upscaleAnalysisSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);

      res.json({
        modelUsed: 'gemini-4-hydrogen',
        contentCategory: parsed.contentCategory || 'mixed',
        denoiseStrength:
          typeof parsed.denoiseStrength === 'number'
            ? parsed.denoiseStrength
            : 26,
        chromaDenoise:
          typeof parsed.chromaDenoise === 'number' ? parsed.chromaDenoise : 42,
        edgeSharpness:
          typeof parsed.edgeSharpness === 'number' ? parsed.edgeSharpness : 72,
        textureBoost:
          typeof parsed.textureBoost === 'number' ? parsed.textureBoost : 48,
        microContrast:
          typeof parsed.microContrast === 'number' ? parsed.microContrast : 32,
        dehaloStrength:
          typeof parsed.dehaloStrength === 'number' ? parsed.dehaloStrength : 80,
        upscaleNotes:
          parsed.upscaleNotes ||
          'AI-guided 5K super-resolution with chroma cleanup and dual-band detail clarity',
      });
    } catch (_error: any) {
      res.json({
        modelUsed: 'gemini-4-hydrogen',
        contentCategory: 'mixed',
        denoiseStrength: 26,
        chromaDenoise: 42,
        edgeSharpness: 72,
        textureBoost: 48,
        microContrast: 32,
        dehaloStrength: 80,
        upscaleNotes:
          'AI-guided 5K super-resolution with chroma cleanup and dual-band detail clarity',
      });
    }
  });

  // Endpoint 3: Fetch Shared Google Drive Image by File ID or Share Link
  app.post('/api/drive/fetch-shared', async (req, res) => {
    try {
      const { fileIdOrUrl } = req.body;
      if (!fileIdOrUrl || typeof fileIdOrUrl !== 'string') {
        res.status(400).json({ error: 'Missing Drive link or file ID' });
        return;
      }

      const trimmed = fileIdOrUrl.trim();
      const matchD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const fileId = matchD
        ? matchD[1]
        : matchId
        ? matchId[1]
        : trimmed.replace(/[^a-zA-Z0-9_-]/g, '');

      if (!fileId) {
        res.status(400).json({ error: 'Invalid Google Drive link or file ID' });
        return;
      }

      const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
        fileId
      )}`;
      const upstream = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });

      if (!upstream.ok) {
        res.status(400).json({
          error: `Could not fetch shared Drive file (${upstream.status}). Ensure the file is shared as "Anyone with the link" or sign in with Google above.`,
        });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        res.status(400).json({
          error:
            'The Drive file is not publicly accessible or is not a direct image file. Make sure link sharing is set to "Anyone with the link".',
        });
        return;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = contentType.startsWith('image/')
        ? contentType.split(';')[0]
        : 'image/png';
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

      res.json({
        fileId,
        name: `drive_${fileId.slice(0, 8)}.png`,
        mimeType,
        sizeBytes: buffer.length,
        dataUrl,
      });
    } catch (error: any) {
      res.status(500).json({
        error: error?.message || 'Failed to fetch shared Google Drive image.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
