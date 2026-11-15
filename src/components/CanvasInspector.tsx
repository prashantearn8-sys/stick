import React, { useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Columns,
  Download,
  Eye,
  EyeOff,
  Redo2,
  Scan,
  Sparkles,
  Square,
  Undo2,
  Wand2,
} from 'lucide-react';
import { WatermarkRegion } from '../lib/inpaint';

export interface BatchImageItem {
  id: string;
  name: string;
  source: 'local' | 'drive';
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
    | 'upscaling'
    | 'error';
  errorMessage?: string;
  detectedRegions: WatermarkRegion[];
  watermarkType?: string;
  estimatedOpacity?: number;
  restorationStrategy?: string;
  restorationMethod?: string;
  upscaled5k?: boolean;
  upscaledWidth?: number;
  upscaledHeight?: number;
  upscaleNotes?: string;
  selectedForBatch: boolean;
}

interface CanvasInspectorProps {
  item: BatchImageItem;
  currentIndex: number;
  totalItemsCount: number;
  onSelectPrev: () => void;
  onSelectNext: () => void;
  applyToAll: boolean;
  onToggleApplyToAll: () => void;
  canUndoDetect: boolean;
  canRedoDetect: boolean;
  onUndoDetect: () => void;
  onRedoDetect: () => void;
  onDetectSingle: (id: string) => void;
  onDetectAll: () => void;
  onRestoreSingle: (
    id: string,
    engine: 'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  ) => void;
  onRestoreAll: (
    engine: 'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  ) => void;
  onExportSingleImage: (item: BatchImageItem) => void;
  onSaveSingleToDrive: (item: BatchImageItem) => void;
  isProcessing: boolean;
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  item,
  currentIndex,
  totalItemsCount,
  onSelectPrev,
  onSelectNext,
  applyToAll,
  onToggleApplyToAll,
  canUndoDetect,
  canRedoDetect,
  onUndoDetect,
  onRedoDetect,
  onDetectSingle,
  onDetectAll,
  onRestoreSingle,
  onRestoreAll,
  onExportSingleImage,
  onSaveSingleToDrive,
  isProcessing,
}) => {
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  const [selectedEngine, setSelectedEngine] = useState<
    'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  >('gemini_ai');
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);

  const handleDetectClick = () => {
    if (applyToAll) {
      onDetectAll();
    } else {
      onDetectSingle(item.id);
    }
  };

  const handleRestoreClick = () => {
    if (applyToAll) {
      onRestoreAll(selectedEngine);
    } else {
      onRestoreSingle(item.id, selectedEngine);
    }
  };

  const updateSplitFromPointer = (clientX: number) => {
    if (!item.restoredDataUrl || !imageFrameRef.current) return;
    const rect = imageFrameRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, Math.round(pct))));
  };

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Top Optical Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          {totalItemsCount > 1 && (
            <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg overflow-hidden shrink-0">
              <button
                type="button"
                disabled={currentIndex <= 0}
                onClick={onSelectPrev}
                className="p-1.5 text-slate-700 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Previous image"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2.5 text-xs font-mono tabular-nums text-slate-700 font-medium">
                {currentIndex + 1} / {totalItemsCount}
              </span>
              <button
                type="button"
                disabled={currentIndex >= totalItemsCount - 1}
                onClick={onSelectNext}
                className="p-1.5 text-slate-700 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Next image"
                aria-label="Next image"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate max-w-xs sm:max-w-md">
              {item.name}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums">
              <span>
                {item.width}×{item.height} px
              </span>
              <span aria-hidden="true">·</span>
              <span>{(item.sizeBytes / 1024).toFixed(0)} KB</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  item.restoredDataUrl
                    ? 'text-emerald-700 font-semibold'
                    : item.detectedRegions.length > 0
                    ? 'text-blue-700 font-semibold'
                    : 'text-slate-500'
                }
              >
                {item.restoredDataUrl
                  ? 'Gemini Watermark Removed'
                  : item.detectedRegions.length > 0
                  ? `${item.detectedRegions.length} Gemini Region${
                      item.detectedRegions.length === 1 ? '' : 's'
                    } Detected`
                  : 'Ready for AI Detection'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap shrink-0">
            <Columns className="w-3.5 h-3.5 text-blue-600" />
            Before / After Split
          </div>

          <button
            type="button"
            onClick={() => setShowBoundingBoxes((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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

          <button
            type="button"
            onClick={() => onExportSingleImage(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-700" />
            Export PNG
          </button>

          <button
            type="button"
            onClick={() => onSaveSingleToDrive(item)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            Save to Drive
          </button>
        </div>
      </div>

      {/* Optical Darkroom Canvas Viewport */}
      <div
        className="relative flex items-center justify-center bg-slate-950 min-h-[440px] max-h-[580px] p-6 overflow-hidden select-none"
        onMouseMove={(e) => {
          if (isDraggingSplit) {
            updateSplitFromPointer(e.clientX);
          }
        }}
        onMouseUp={() => setIsDraggingSplit(false)}
        onMouseLeave={() => setIsDraggingSplit(false)}
      >
        <div
          ref={imageFrameRef}
          onMouseDown={(e) => {
            if (item.restoredDataUrl) {
              setIsDraggingSplit(true);
              updateSplitFromPointer(e.clientX);
            }
          }}
          className={`relative inline-block max-w-full max-h-[510px] border border-slate-800 bg-slate-900 rounded-lg overflow-hidden ${
            item.restoredDataUrl ? 'cursor-ew-resize' : ''
          }`}
        >
          <img
            src={item.restoredDataUrl ? item.restoredDataUrl : item.originalDataUrl}
            alt={item.name}
            referrerPolicy="no-referrer"
            className="block max-w-full max-h-[500px] w-auto h-auto object-contain pointer-events-none"
          />

          {item.restoredDataUrl && (
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

          {item.restoredDataUrl && (
            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow-md pointer-events-none"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-300 shadow-md flex items-center justify-center text-slate-800 text-[10px] font-mono">
                ↔
              </div>
            </div>
          )}

          {item.restoredDataUrl && (
            <>
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-slate-950/80 text-slate-100 text-xs font-medium pointer-events-none">
                Before · With Gemini Watermark
              </div>
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded bg-blue-600/95 text-white text-xs font-medium pointer-events-none">
                After · Restored Lossless PNG
              </div>
            </>
          )}

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
                  <span className="absolute -top-5 left-0 px-1.5 py-0.5 bg-amber-400 text-slate-950 text-[10px] font-mono font-semibold whitespace-nowrap rounded-xs">
                    {reg.label || 'Gemini Watermark'}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Interactive Split Comparison Slider Bar */}
      {item.restoredDataUrl && (
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
            Split Position: {sliderPos}%
          </span>
        </div>
      )}

      {/* Primary AI Detection (with Dedicated Undo/Redo & Apply to All) and Restoration Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 px-5 py-4 border-t border-slate-200 bg-white">
        {/* Left Control Group: Detect Watermarks (AI) + Undo/Redo (Strictly for Detection) + Apply to All (Default ON) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleDetectClick}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Scan className="w-4 h-4 text-blue-600" />
            {item.status === 'detecting' || isProcessing
              ? applyToAll && totalItemsCount > 1
                ? `Detecting All (${totalItemsCount})...`
                : 'Detecting Watermark...'
              : 'Detect Watermarks (AI)'}
          </button>

          {/* Undo / Redo specifically for Detect Watermarks (AI) */}
          <div
            className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden shrink-0"
            role="group"
            aria-label="Undo or Redo Detect Watermarks (AI)"
          >
            <button
              type="button"
              disabled={!canUndoDetect || isProcessing}
              onClick={onUndoDetect}
              title="Undo Detect Watermarks (AI) (Ctrl+Z)"
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors border-r border-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Undo
            </button>
            <button
              type="button"
              disabled={!canRedoDetect || isProcessing}
              onClick={onRedoDetect}
              title="Redo Detect Watermarks (AI) (Ctrl+Y)"
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
              Redo
            </button>
          </div>

          {/* Apply to All Toggle Button (Default ON) */}
          <button
            type="button"
            onClick={onToggleApplyToAll}
            aria-pressed={applyToAll}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              applyToAll
                ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
            title="Default ON: Detect Watermarks (AI) and Remove Watermark & Restore apply to all uploaded pages"
          >
            {applyToAll ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>
              Apply to All
              {totalItemsCount > 1 ? ` (${totalItemsCount} Pages)` : ''}
            </span>
          </button>
        </div>

        {/* Right Control Group: Restoration Engine & Primary Remove Watermark CTA */}
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={handleRestoreClick}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {selectedEngine === 'hybrid_inpaint' ? (
              <Wand2 className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {item.status === 'restoring'
              ? 'Removing Watermark...'
              : item.restoredDataUrl
              ? applyToAll && totalItemsCount > 1
                ? `Re-Run All (${totalItemsCount})`
                : 'Re-Run Restoration'
              : applyToAll && totalItemsCount > 1
              ? `Remove Watermark & Restore All (${totalItemsCount})`
              : 'Remove Watermark & Restore'}
          </button>
        </div>
      </div>

      {/* Detection Metadata Footer */}
      {(item.watermarkType || item.restorationStrategy || item.errorMessage) && (
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.watermarkType && (
              <>
                <span className="font-semibold text-slate-800">
                  Detected Target: {item.watermarkType}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {typeof item.estimatedOpacity === 'number' && (
              <>
                <span className="font-mono tabular-nums">
                  Opacity: {item.estimatedOpacity}%
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {item.restorationStrategy && (
              <span>Method: {item.restorationStrategy}</span>
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
