import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

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
      description: 'Always 1 for the bottom-right Gemini sparkle watermark.',
    },
    watermarkType: {
      type: Type.STRING,
      description:
        'Description of the bottom-right Gemini sparkle watermark (e.g., Bottom-Right Gemini 4-Point Sparkle).',
    },
    estimatedOpacity: {
      type: Type.INTEGER,
      description:
        'Estimated opacity percentage of the bottom-right Gemini sparkle from 0 to 100.',
    },
    restorationStrategy: {
      type: Type.STRING,
      description:
        'Technical strategy to inpaint only the bottom-right Gemini sparkle star while preserving surrounding line art and color.',
    },
    regions: {
      type: Type.ARRAY,
      description:
        'Single tight bounding box strictly around the four-pointed Gemini sparkle icon in the bottom-right corner (xmin between 900-975, ymin between 885-955, xmax between 955-992, ymax between 945-990 in 0-1000 normalized coordinates).',
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

  // Endpoint 1: Bottom-Right Gemini Watermark Detection (Free-tier gemini-4-hydrogen)
  app.post('/api/watermark/detect', async (req, res) => {
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
                mimeType,
                data: imageBase64,
              },
            },
            {
              text:
                'Focus EXCLUSIVELY on the bottom-right corner of this Gemini-generated image (normalized x: 880 to 995, y: 860 to 995). ' +
                'Locate the small semi-transparent 4-pointed Gemini sparkle/star watermark in the bottom-right corner. ' +
                'Do NOT flag any other part of the image. Return a single tight normalized bounding box (0-1000) around ONLY the bottom-right Gemini sparkle icon.',
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: watermarkAnalysisSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const clampedRegions = clampToBottomRightGeminiZone(parsed.regions);

      res.json({
        hasWatermark: true,
        watermarkCount: 1,
        watermarkType:
          parsed.watermarkType || 'Bottom-Right Gemini 4-Point Sparkle',
        estimatedOpacity:
          typeof parsed.estimatedOpacity === 'number'
            ? parsed.estimatedOpacity
            : 55,
        restorationStrategy:
          parsed.restorationStrategy ||
          'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
        regions: clampedRegions,
      });
    } catch (_error: any) {
      res.json({
        hasWatermark: true,
        watermarkCount: 1,
        watermarkType: 'Bottom-Right Gemini 4-Point Sparkle',
        estimatedOpacity: 55,
        restorationStrategy:
          'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
        regions: clampToBottomRightGeminiZone([]),
      });
    }
  });

  // Endpoint 2: Bottom-Right Gemini Watermark Removal Guidance (Free-tier gemini-4-hydrogen)
  app.post('/api/watermark/restore', async (req, res) => {
    try {
      const { imageBase64, mimeType, detectedRegions = [] } = req.body;

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
                'Inspect ONLY the bottom-right corner of this Gemini-generated image (normalized x: 880 to 995, y: 860 to 995) and return the exact tight normalized bounding box (0-1000) of the 4-pointed Gemini sparkle watermark so our inpainting engine removes only that bottom-right sparkle without altering any other region.',
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: watermarkAnalysisSchema,
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const finalRegions = clampToBottomRightGeminiZone(
        Array.isArray(parsed.regions) && parsed.regions.length > 0
          ? parsed.regions
          : detectedRegions
      );

      res.json({
        modelUsed: 'gemini-4-hydrogen',
        regions: finalRegions,
        watermarkType:
          parsed.watermarkType || 'Bottom-Right Gemini 4-Point Sparkle',
        estimatedOpacity:
          typeof parsed.estimatedOpacity === 'number'
            ? parsed.estimatedOpacity
            : 55,
        restorationStrategy:
          parsed.restorationStrategy ||
          'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
      });
    } catch (_error: any) {
      res.json({
        modelUsed: 'gemini-4-hydrogen',
        regions: clampToBottomRightGeminiZone(req.body?.detectedRegions || []),
        watermarkType: 'Bottom-Right Gemini 4-Point Sparkle',
        estimatedOpacity: 55,
        restorationStrategy:
          'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
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
