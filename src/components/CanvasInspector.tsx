import React, { useEffect, useRef, useState } from 'react';
import {
  Brush,
  Columns,
  Eraser,
  Eye,
  EyeOff,
  RotateCcw,
  Scan,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { WatermarkRegion } from '../lib/inpaint';

export interface BatchImageItem {
  id: string;
  name: string;
  source: 'local' | 'drive' | 'sample';
  driveFileId?: string;
  originalDataUrl: string;
  restoredDataUrl: string | null;
  maskDataUrl: string | null;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  status:
    | 'queued'
    | 'detecting'
    | 'detected'
    | 'restoring'
    | 'restored'
    | 'error';
  errorMessage?: string;
  detectedRegions: WatermarkRegion[];
  watermarkType?: string;
  estimatedOpacity?: number;
  restorationStrategy?: string;
  restorationMethod?: string;
  selectedForBatch: boolean;
}

interface CanvasInspectorProps {
  item: BatchImageItem;
  onUpdateMask: (id: string, maskDataUrl: string | null) => void;
  onDetectSingle: (id: string) => void;
  onRestoreSingle: (
    id: string,
    engine: 'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  ) => void;
  onExportSingleImage: (item: BatchImageItem) => void;
  onSaveSingleToDrive: (item: BatchImageItem) => void;
  isProcessing: boolean;
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  item,
  onUpdateMask,
  onDetectSingle,
  onRestoreSingle,
  onExportSingleImage,
  onSaveSingleToDrive,
  isProcessing,
}) => {
  const [viewMode, setViewMode] = useState<'compare' | 'mask'>('compare');
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  const [brushSize, setBrushSize] = useState<number>(28);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [selectedEngine, setSelectedEngine] = useState<
    'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  >('gemini_ai');

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Switch to compare view automatically when restoration finishes
  useEffect(() => {
    if (item.restoredDataUrl) {
      setViewMode('compare');
    }
  }, [item.id, item.restoredDataUrl]);

  // Sync existing mask onto the mask canvas
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.width = item.width || 960;
    canvas.height = item.height || 640;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (item.maskDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = item.maskDataUrl;
    }
  }, [item.id, item.width, item.height, item.maskDataUrl, viewMode]);

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewMode !== 'mask') return;
    setIsDrawing(true);
    const pt = getCanvasPoint(e);
    drawStroke(pt.x, pt.y);
  };

  const drawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || viewMode !== 'mask') return;
    const pt = getCanvasPoint(e);
    drawStroke(pt.x, pt.y);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = maskCanvasRef.current;
    if (canvas) {
      onUpdateMask(item.id, canvas.toDataURL('image/png'));
    }
  };

  const drawStroke = (x: number, y: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  const handleClearMask = () => {
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onUpdateMask(item.id, null);
  };

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Studio Inspector Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 truncate max-w-xs">
            {item.name}
          </h2>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums">
            <span>
              {item.width}×{item.height}
            </span>
            <span aria-hidden="true">·</span>
            <span>{(item.sizeBytes / 1024).toFixed(0)} KB</span>
            <span aria-hidden="true">·</span>
            <span>
              {item.detectedRegions.length} region
              {item.detectedRegions.length === 1 ? '' : 's'} detected
            </span>
          </div>
        </div>

        {/* Interactive Mode Switcher & Detection Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/75 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('compare')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'compare'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Split Compare
            </button>
            <button
              type="button"
              onClick={() => setViewMode('mask')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'mask'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Brush className="w-3.5 h-3.5" />
              Inpaint Mask Brush
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowBoundingBoxes((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {showBoundingBoxes ? (
              <>
                <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                Hide AI Boxes
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                Show AI Boxes
              </>
            )}
          </button>
        </div>
      </div>

      {/* Secondary Brush Sub-toolbar when in Mask Mode */}
      {viewMode === 'mask' && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-2.5 bg-slate-100/80 border-b border-slate-200 text-xs">
          <div className="flex items-center gap-4">
            <span className="text-slate-600 font-medium">
              Paint over stubborn watermarks or text stamps to guide content-aware fill:
            </span>
            <label className="flex items-center gap-2 font-mono tabular-nums text-slate-700">
              <span>Brush Radius: {brushSize}px</span>
              <input
                type="range"
                min={8}
                max={64}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-24 accent-blue-600"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleClearMask}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Eraser className="w-3.5 h-3.5" />
            Clear Painted Mask
          </button>
        </div>
      )}

      {/* Main Viewport Canvas Area */}
      <div
        ref={containerRef}
        className="relative flex items-center justify-center bg-checkerboard min-h-[420px] max-h-[560px] p-6 overflow-hidden select-none"
      >
        <div className="relative inline-block max-w-full max-h-[500px] shadow-sm border border-slate-300 bg-slate-900 rounded-lg overflow-hidden">
          {/* Base Image: either Restored (right side in compare) or Original */}
          <img
            src={
              viewMode === 'compare' && item.restoredDataUrl
                ? item.restoredDataUrl
                : item.originalDataUrl
            }
            alt={item.name}
            referrerPolicy="no-referrer"
            className="block max-w-full max-h-[490px] w-auto h-auto object-contain pointer-events-none"
          />

          {/* Before/After Split Overlay when Restored Image exists */}
          {viewMode === 'compare' && item.restoredDataUrl && (
            <div
              className="absolute inset-0 overflow-hidden pointer-events-none"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img
                src={item.originalDataUrl}
                alt={`Original ${item.name}`}
                referrerPolicy="no-referrer"
                className="block w-full h-full object-contain"
              />
            </div>
          )}

          {/* Split Slider Divider Handle */}
          {viewMode === 'compare' && item.restoredDataUrl && (
            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow-md pointer-events-none"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-300 shadow-md flex items-center justify-center text-slate-700 text-[10px] font-mono">
                ↔
              </div>
            </div>
          )}

          {/* Corner Comparison Labels */}
          {viewMode === 'compare' && item.restoredDataUrl && (
            <>
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-black/70 text-white text-xs font-medium pointer-events-none">
                Original Watermarked
              </div>
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded bg-blue-600/90 text-white text-xs font-medium pointer-events-none">
                Restored Output
              </div>
            </>
          )}

          {/* AI Detected Watermark Bounding Boxes */}
          {showBoundingBoxes &&
            item.detectedRegions.map((reg, idx) => {
              const top = `${(reg.ymin / 1000) * 100}%`;
              const left = `${(reg.xmin / 1000) * 100}%`;
              const height = `${Math.max(2, ((reg.ymax - reg.ymin) / 1000) * 100)}%`;
              const width = `${Math.max(2, ((reg.xmax - reg.xmin) / 1000) * 100)}%`;
              return (
                <div
                  key={`${reg.label}-${idx}`}
                  style={{ top, left, width, height }}
                  className="absolute border-2 border-amber-400 bg-amber-400/15 pointer-events-none transition-opacity"
                >
                  <span className="absolute -top-5 left-0 px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[10px] font-mono font-semibold whitespace-nowrap rounded-xs">
                    {reg.label || 'Watermark'}
                  </span>
                </div>
              );
            })}

          {/* Interactive Brush Mask Canvas Overlay */}
          <canvas
            ref={maskCanvasRef}
            onMouseDown={startDrawing}
            onMouseMove={drawMove}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            className={`absolute inset-0 w-full h-full ${
              viewMode === 'mask'
                ? 'cursor-crosshair pointer-events-auto'
                : 'pointer-events-none opacity-60'
            }`}
          />
        </div>
      </div>

      {/* Interactive Split Slider Bar (when Restored image is present in Compare mode) */}
      {viewMode === 'compare' && item.restoredDataUrl && (
        <div className="flex items-center justify-center gap-4 px-6 py-2.5 bg-slate-50 border-t border-slate-200 text-xs">
          <span className="text-slate-500 font-medium">Original (0%)</span>
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="w-64 accent-blue-600 cursor-pointer"
            aria-label="Before and after comparison split slider"
          />
          <span className="text-slate-700 font-medium font-mono tabular-nums">
            Restored Split: {sliderPos}%
          </span>
        </div>
      )}

      {/* Bottom Action & AI Model Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-t border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => onDetectSingle(item.id)}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Scan className="w-4 h-4 text-blue-600" />
            {item.status === 'detecting'
              ? 'Scanning Regions...'
              : 'Detect Watermarks (AI)'}
          </button>

          <div className="flex items-center gap-2">
            <select
              value={selectedEngine}
              onChange={(e) =>
                setSelectedEngine(
                  e.target.value as
                    | 'gemini_ai'
                    | 'hybrid_inpaint'
                    | 'high_quality'
                )
              }
              aria-label="Select Restoration Engine"
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="gemini_ai">
                AI-Guided Content-Aware Inpaint (Gemini 4 Flash)
              </option>
              <option value="high_quality">
                Deep Multi-Pass Patch Reconstruction
              </option>
              <option value="hybrid_inpaint">
                Fast Boundary-Marching Texture Fill
              </option>
            </select>

            <button
              type="button"
              disabled={isProcessing}
              onClick={() => onRestoreSingle(item.id, selectedEngine)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {selectedEngine === 'hybrid_inpaint' ? (
                <Wand2 className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {item.status === 'restoring'
                ? 'Reconstructing Image...'
                : item.restoredDataUrl
                ? 'Re-Run Restoration'
                : 'Remove Watermark & Restore'}
            </button>
          </div>
        </div>

        {/* Single Image Export & Drive Upload Actions */}
        <div className="flex items-center gap-2.5">
          {item.restoredDataUrl && (
            <button
              type="button"
              onClick={() =>
                onUpdateMask(item.id, item.maskDataUrl)
              }
              title="Reset view"
              className="hidden"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onExportSingleImage(item)}
            className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Export Image
          </button>
          <button
            type="button"
            onClick={() => onSaveSingleToDrive(item)}
            className="px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Save to Google Drive
          </button>
        </div>
      </div>

      {/* AI Analysis Notes Strip (Unboxed clean metadata per design guidelines) */}
      {(item.watermarkType || item.restorationStrategy || item.errorMessage) && (
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.watermarkType && (
              <>
                <span className="font-semibold text-slate-800">
                  Detected Pattern: {item.watermarkType}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {typeof item.estimatedOpacity === 'number' && (
              <>
                <span className="font-mono tabular-nums">
                  Est. Opacity: {item.estimatedOpacity}%
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {item.restorationStrategy && (
              <span>Strategy: {item.restorationStrategy}</span>
            )}
          </div>
          {item.errorMessage && (
            <span className="text-red-600 font-medium">{item.errorMessage}</span>
          )}
        </div>
      )}
    </div>
  );
};
