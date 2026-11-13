import 'dotenv/config';
import express from 'express';
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

const watermarkAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    hasWatermark: {
      type: Type.BOOLEAN,
      description: 'True if one or more watermarks or overlays are detected.',
    },
    watermarkCount: {
      type: Type.INTEGER,
      description: 'Total count of distinct or repeating watermark regions detected.',
    },
    watermarkType: {
      type: Type.STRING,
      description:
        'Classification of watermark (e.g., Diagonal Tiled Stamp, Corner Logo, Center Stock Overlay, Timestamp, None).',
    },
    estimatedOpacity: {
      type: Type.INTEGER,
      description: 'Estimated opacity percentage of the watermark from 0 to 100.',
    },
    restorationStrategy: {
      type: Type.STRING,
      description:
        'Concise technical description of how to reconstruct and inpaint the occluded regions.',
    },
    regions: {
      type: Type.ARRAY,
      description:
        'Tight bounding boxes for every watermark element, text character group, border line, or stamp in 0-1000 normalized coordinates.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description: 'Text or logo description of this watermark region.',
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
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Endpoint 1: AI Watermark Detection & Restoration Analysis (Free-tier gemini-4-hydrogen)
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
                'Analyze this image for watermarks, text overlays, stock photo stamps, logos, borders, date stamps, or semi-transparent artifacts. ' +
                'Identify every watermark region with tight normalized coordinates (ymin, xmin, ymax, xmax from 0 to 1000) and describe the underlying background texture needed for content-aware inpainting.',
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
      res.json(parsed);
    } catch (error: any) {
      console.error('Watermark detection error:', error);
      res.status(500).json({
        error: error?.message || 'Failed to analyze image for watermarks.',
      });
    }
  });

  // Endpoint 2: AI-Guided Restoration Parameters (Uses free-tier gemini-4-hydrogen)
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
                'Inspect this watermarked image and provide precise normalized bounding boxes (0-1000) for all watermark text, stamp boxes, and corner logos so our content-aware inpainting engine can reconstruct the underlying pixels cleanly.',
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

      res.json({
        modelUsed: 'gemini-4-hydrogen',
        regions:
          Array.isArray(parsed.regions) && parsed.regions.length > 0
            ? parsed.regions
            : detectedRegions,
        watermarkType: parsed.watermarkType || 'Semi-Transparent Overlay',
        estimatedOpacity:
          typeof parsed.estimatedOpacity === 'number'
            ? parsed.estimatedOpacity
            : 50,
        restorationStrategy:
          parsed.restorationStrategy ||
          'AI-guided content-aware boundary marching and patch synthesis',
      });
    } catch (error: any) {
      console.error('Watermark restoration guidance error:', error);
      res.status(500).json({
        error: error?.message || 'AI watermark analysis failed.',
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

      // Extract Google Drive file ID from common URL formats or raw ID
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
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
