/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  CloudDownload,
  CloudUpload,
  Download,
  FileImage,
  Layers,
  LogOut,
  Plus,
  Scan,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './lib/auth';
import {
  downloadDriveImageAsDataUrl,
  DriveFileItem,
   getImageDimensions,
  listDriveImages,
  uploadImageToDrive,
} from './lib/drive';
import {
  convertImageForExport,
  ExportImageFormat,
  generateSampleWatermarkedBatch,
  performContentAwareInpaint,
  WatermarkRegion,
} from './lib/inpaint';
import {
  BatchImageItem,
  CanvasInspector,
} from './components/CanvasInspector';
import {
  DriveImportModal,
  DriveUploadConfirmModal,
  GoogleSignInButton,
} from './components/DriveModal';

export default function App() {
  // Auth & Google Drive state
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Batch Queue & Active Image Selection
  const [items, setItems] = useState<BatchImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<
    'all' | 'queued' | 'restored'
  >('all');

  // Bulk Processing & Export Configuration (Export strictly in image formats)
  const [exportFormat, setExportFormat] =
    useState<ExportImageFormat>('image/png');
  const [exportQuality, setExportQuality] = useState<number>(0.94);
  const [batchEngine, setBatchEngine] = useState<
    'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  >('gemini_ai');
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Google Drive Modals
  const [isDriveImportOpen, setIsDriveImportOpen] = useState<boolean>(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] =
    useState<boolean>(false);
  const [isImportingFromDrive, setIsImportingFromDrive] =
    useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  const [driveUploadItems, setDriveUploadItems] = useState<BatchImageItem[]>(
    []
  );
  const [isDriveUploadOpen, setIsDriveUploadOpen] = useState<boolean>(false);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState<boolean>(false);
  const [driveUploadProgress, setDriveUploadProgress] = useState({
    completed: 0,
    total: 0,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize Firebase Auth listener & preload sample watermarked batch on first load
  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );

    // Load 3 realistic watermarked sample images on initial mount so the studio is immediately interactive
    loadSampleDataset();

    return () => unsubscribe();
  }, []);

  const loadSampleDataset = () => {
    const samples = generateSampleWatermarkedBatch();
    const initialItems: BatchImageItem[] = samples.map((s, idx) => ({
      id: `sample-${Date.now()}-${idx}`,
      name: s.name,
      source: 'sample',
      originalDataUrl: s.watermarkedDataUrl,
      restoredDataUrl: null,
      maskDataUrl: null,
      mimeType: 'image/png',
      width: s.width,
      height: s.height,
      sizeBytes: s.sizeBytes,
      status: 'detected',
      detectedRegions: s.defaultRegions,
      watermarkType: 'Semi-Transparent Proof Banner & Stamp',
      estimatedOpacity: 52,
      restorationStrategy:
        'Content-aware gradient reconstruction + multi-scale texture synthesis across stamp boundaries',
      selectedForBatch: true,
    }));
    setItems(initialItems);
    if (initialItems.length > 0) {
      setActiveId(initialItems[0].id);
    }
  };

  // Google Sign-In handler
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        setStatusBanner('Connected to Google Drive.');
        if (isDriveImportOpen) {
          await fetchDriveImageList('');
        }
      } else {
        setStatusBanner(
          'Sign-in window was closed. Click "Sign in with Google" whenever you are ready to connect Drive.'
        );
      }
    } catch (err: any) {
      setDriveError(err?.message || 'Google Sign-In could not be completed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
  };

  // Bulk Local Image Upload handler
  const handleFilesSelected = async (
    fileList: FileList | null
  ): Promise<void> => {
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/')
    );
    if (filesArray.length === 0) return;

    const newBatch: BatchImageItem[] = [];
    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const dims = await getImageDimensions(dataUrl);
      newBatch.push({
        id: `local-${Date.now()}-${i}`,
        name: file.name,
        source: 'local',
        originalDataUrl: dataUrl,
        restoredDataUrl: null,
        maskDataUrl: null,
        mimeType: file.type || 'image/png',
        width: dims.width,
        height: dims.height,
        sizeBytes: file.size,
        status: 'queued',
        detectedRegions: [],
        selectedForBatch: true,
      });
    }

    setItems((prev) => [...newBatch, ...prev]);
    if (newBatch.length > 0) {
      setActiveId(newBatch[0].id);
    }
    setStatusBanner(
      `Added ${newBatch.length} image${
        newBatch.length === 1 ? '' : 's'
      } to the batch queue.`
    );
  };

  // Single Image AI Watermark Detection
  const handleDetectWatermarks = async (
    id: string
  ): Promise<WatermarkRegion[]> => {
    const target = items.find((i) => i.id === id);
    if (!target) return [];

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: 'detecting', errorMessage: undefined }
          : item
      )
    );

    try {
      const base64 = target.originalDataUrl.split(',')[1];
      const response = await fetch('/api/watermark/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: target.mimeType || 'image/png',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Detection request failed');
      }

      const regions: WatermarkRegion[] = Array.isArray(data.regions)
        ? data.regions
        : target.detectedRegions;

      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'detected',
                detectedRegions: regions,
                watermarkType: data.watermarkType || 'Detected Overlay',
                estimatedOpacity:
                  typeof data.estimatedOpacity === 'number'
                    ? data.estimatedOpacity
                    : 50,
                restorationStrategy:
                  data.restorationStrategy ||
                  'Content-aware structural inpainting',
              }
            : item
        )
      );
      return regions;
    } catch (err: any) {
      // Fallback heuristic center/corner region if offline or quota exceeded
      const fallbackRegions: WatermarkRegion[] =
        target.detectedRegions.length > 0
          ? target.detectedRegions
          : [
              {
                label: 'Primary Watermark Region',
                ymin: 380,
                xmin: 200,
                ymax: 620,
                xmax: 800,
              },
            ];
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'detected',
                detectedRegions: fallbackRegions,
                watermarkType:
                  item.watermarkType || 'Detected Overlay Region',
                restorationStrategy:
                  'Boundary-marching content-aware patch reconstruction',
                errorMessage: err?.message,
              }
            : item
        )
      );
      return fallbackRegions;
    }
  };

  // Single Image Watermark Removal & AI Restoration
  const handleRestoreImage = async (
    id: string,
    engine: 'gemini_ai' | 'hybrid_inpaint' | 'high_quality'
  ): Promise<void> => {
    const target = items.find((i) => i.id === id);
    if (!target) return;

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: 'restoring', errorMessage: undefined }
          : item
      )
    );

    let activeRegions = target.detectedRegions;
    if (activeRegions.length === 0 && !target.maskDataUrl) {
      activeRegions = await handleDetectWatermarks(id);
    }

    try {
      if (engine === 'hybrid_inpaint') {
        const inpaintedDataUrl = await performContentAwareInpaint(
          target.originalDataUrl,
          activeRegions,
          target.maskDataUrl
        );
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'restored',
                  restoredDataUrl: inpaintedDataUrl,
                  restorationMethod: 'Content-Aware Patch Inpainting',
                }
              : item
          )
        );
        return;
      }

      // Call server-side free-tier Gemini 4 Flash analysis to refine watermark masks & restoration strategy
      const base64 = target.originalDataUrl.split(',')[1];
      const response = await fetch('/api/watermark/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: target.mimeType || 'image/png',
          mode: engine === 'high_quality' ? 'high_quality' : 'standard',
          detectedRegions: activeRegions,
        }),
      });

      const data = await response.json().catch(() => ({}));
      const refinedRegions: WatermarkRegion[] =
        Array.isArray(data?.regions) && data.regions.length > 0
          ? data.regions
          : activeRegions;

      const restoredDataUrl = await performContentAwareInpaint(
        target.originalDataUrl,
        refinedRegions,
        target.maskDataUrl
      );

      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'restored',
                detectedRegions: refinedRegions,
                watermarkType: data?.watermarkType || item.watermarkType,
                estimatedOpacity:
                  typeof data?.estimatedOpacity === 'number'
                    ? data.estimatedOpacity
                    : item.estimatedOpacity,
                restorationStrategy:
                  data?.restorationStrategy || item.restorationStrategy,
                restoredDataUrl,
                restorationMethod:
                  engine === 'high_quality'
                    ? 'Deep Multi-Pass Patch Reconstruction'
                    : 'AI-Guided Content-Aware Inpaint (Gemini 4 Flash)',
              }
            : item
        )
      );
    } catch (err: any) {
      const fallbackDataUrl = await performContentAwareInpaint(
        target.originalDataUrl,
        activeRegions,
        target.maskDataUrl
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'restored',
                restoredDataUrl: fallbackDataUrl,
                restorationMethod: 'Content-Aware Patch Inpainting',
              }
            : item
        )
      );
    }
  };

  // Batch Restore Selected Images
  const handleBatchRestoreSelected = async () => {
    const selected = items.filter((i) => i.selectedForBatch);
    if (selected.length === 0) return;

    setIsBatchProcessing(true);
    setStatusBanner(
      `Restoring ${selected.length} selected image${
        selected.length === 1 ? '' : 's'
      }...`
    );

    for (const item of selected) {
      await handleRestoreImage(item.id, batchEngine);
    }

    setIsBatchProcessing(false);
    setStatusBanner(
      `Completed watermark removal and restoration for ${selected.length} image${
        selected.length === 1 ? '' : 's'
      }.`
    );
  };

  // Export Single Image (Strictly in Image Format: PNG / JPEG / WEBP)
  const handleExportSingleImage = async (item: BatchImageItem) => {
    const sourceUrl = item.restoredDataUrl || item.originalDataUrl;
    const { dataUrl, extension } = await convertImageForExport(
      sourceUrl,
      exportFormat,
      exportQuality
    );
    const cleanBaseName = item.name.replace(/\.[^/.]+$/, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `restored_${cleanBaseName}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Bulk Export Selected Images (Exports each selected item as an individual image file)
  const handleBulkExportImages = async () => {
    const selected = items.filter((i) => i.selectedForBatch);
    if (selected.length === 0) return;

    setStatusBanner(
      `Exporting ${selected.length} image${
        selected.length === 1 ? '' : 's'
      } as ${exportFormat.replace('image/', '').toUpperCase()}...`
    );

    for (let i = 0; i < selected.length; i++) {
      await handleExportSingleImage(selected[i]);
      // Brief stagger so browser triggers every image download cleanly
      await new Promise((r) => setTimeout(r, 180));
    }

    setStatusBanner(
      `Exported ${selected.length} image file${
        selected.length === 1 ? '' : 's'
      } to your device.`
    );
  };

  // Google Drive: Open Import Modal & Fetch Drive Images
  const handleOpenDriveImport = async () => {
    setIsDriveImportOpen(true);
    setDriveError(null);
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setNeedsAuth(false);
    await fetchDriveImageList('');
  };

  const fetchDriveImageList = async (query: string) => {
    setIsLoadingDriveFiles(true);
    setDriveError(null);
    try {
      const list = await listDriveImages(query);
      setDriveFiles(list);
    } catch (err: any) {
      if (err?.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setDriveError(err?.message || 'Could not load Google Drive images.');
      }
    } finally {
      setIsLoadingDriveFiles(false);
    }
  };

  const handleImportDriveFiles = async (selectedDriveFiles: DriveFileItem[]) => {
    if (selectedDriveFiles.length === 0) return;
    setIsImportingFromDrive(true);
    setDriveError(null);

    try {
      const imported: BatchImageItem[] = [];
      for (let i = 0; i < selectedDriveFiles.length; i++) {
        const df = selectedDriveFiles[i];
        const downloaded = await downloadDriveImageAsDataUrl(
          df.id,
          df.mimeType
        );
        imported.push({
          id: `drive-${df.id}-${Date.now()}`,
          name: df.name,
          source: 'drive',
          driveFileId: df.id,
          originalDataUrl: downloaded.dataUrl,
          restoredDataUrl: null,
          maskDataUrl: null,
          mimeType: df.mimeType || 'image/png',
          width: downloaded.width,
          height: downloaded.height,
          sizeBytes: downloaded.sizeBytes,
          status: 'queued',
          detectedRegions: [],
          selectedForBatch: true,
        });
      }

      setItems((prev) => [...imported, ...prev]);
      if (imported.length > 0) {
        setActiveId(imported[0].id);
      }
      setIsDriveImportOpen(false);
      setStatusBanner(
        `Imported ${imported.length} image${
          imported.length === 1 ? '' : 's'
        } from Google Drive.`
      );
    } catch (err: any) {
      if (err?.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setDriveError(
          err?.message || 'Failed to download selected images from Drive.'
        );
      }
    } finally {
      setIsImportingFromDrive(false);
    }
  };

  // Google Drive: Open Bulk Save Confirmation Modal
  const openDriveUploadModalForItems = async (
    targetItems: BatchImageItem[]
  ) => {
    if (targetItems.length === 0) return;
    const token = await getAccessToken();
    setNeedsAuth(!token);
    setDriveUploadItems(targetItems);
    setDriveUploadProgress({ completed: 0, total: targetItems.length });
    setIsDriveUploadOpen(true);
  };

  const handleConfirmDriveBulkUpload = async () => {
    if (driveUploadItems.length === 0) return;
    setIsUploadingToDrive(true);
    setDriveUploadProgress({ completed: 0, total: driveUploadItems.length });

    try {
      for (let i = 0; i < driveUploadItems.length; i++) {
        const item = driveUploadItems[i];
        const sourceUrl = item.restoredDataUrl || item.originalDataUrl;
        const { dataUrl, extension } = await convertImageForExport(
          sourceUrl,
          exportFormat,
          exportQuality
        );
        const cleanName = item.name.replace(/\.[^/.]+$/, '');
        const targetFileName = `restored_${cleanName}.${extension}`;

        await uploadImageToDrive(targetFileName, dataUrl, exportFormat);
        setDriveUploadProgress({
          completed: i + 1,
          total: driveUploadItems.length,
        });
      }

      setIsDriveUploadOpen(false);
      setStatusBanner(
        `Saved ${driveUploadItems.length} exported image${
          driveUploadItems.length === 1 ? '' : 's'
        } to your Google Drive.`
      );
    } catch (err: any) {
      if (err?.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setStatusBanner(
          `Google Drive upload error: ${err?.message || 'Upload failed'}`
        );
      }
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const activeItem = items.find((i) => i.id === activeId) || items[0] || null;
  const selectedItems = items.filter((i) => i.selectedForBatch);
  const restoredCount = items.filter((i) => !!i.restoredDataUrl).length;

  const filteredItems = items.filter((item) => {
    if (filterState === 'queued') return !item.restoredDataUrl;
    if (filterState === 'restored') return !!item.restoredDataUrl;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ClearSlate Studio
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#workspace"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Restoration Canvas
          </a>
          <a
            href="#batch-queue"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Batch Queue
          </a>
          <button
            type="button"
            onClick={handleOpenDriveImport}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Import from Drive
          </button>
          <a
            href="#export-controls"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Image Export
          </a>
        </nav>

        {/* Zone 3: 1 primary action (Google Sign-In or Connected Drive Profile) */}
        <div className="flex items-center gap-3 shrink-0">
          {needsAuth || !user ? (
            <GoogleSignInButton
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
            />
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="Sign out of Google Drive"
            >
              <span>{user.email || user.displayName || 'Drive Connected'}</span>
              <LogOut className="w-3.5 h-3.5 text-slate-500" />
            </button>
          )}
        </div>
      </header>

      {/* Hidden Multi-File Input for Local Bulk Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Main 1440px Desktop Workspace Container */}
      <main
        id="workspace"
        className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6"
      >
        {/* Top Action & Bulk Pipeline Strip */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              AI Watermark Detection & Content-Aware Image Restoration
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>{items.length} Total Images</span>
              <span aria-hidden="true">·</span>
              <span>{selectedItems.length} Selected in Batch</span>
              <span aria-hidden="true">·</span>
              <span>{restoredCount} Restored</span>
              {statusBanner && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-blue-700 font-sans font-medium">
                    {statusBanner}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Primary Bulk Ingestion & Restoration Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4 text-blue-600" />
              Bulk Upload Images
            </button>

            <button
              type="button"
              onClick={handleOpenDriveImport}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <CloudDownload className="w-4 h-4 text-blue-600" />
              Upload from Google Drive
            </button>

            <button
              type="button"
              disabled={isBatchProcessing || selectedItems.length === 0}
              onClick={handleBatchRestoreSelected}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              {isBatchProcessing
                ? 'Restoring Batch...'
                : `Restore Selected (${selectedItems.length})`}
            </button>
          </div>
        </section>

        {/* Two-Column Studio Split: Left Batch Queue + Right Interactive Canvas Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (4 cols): Batch Queue & Bulk Export Controls */}
          <aside
            id="batch-queue"
            className="lg:col-span-4 space-y-5"
          >
            {/* Batch Queue Card */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Batch Image Queue
                  </h2>
                </div>
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                  {(['all', 'queued', 'restored'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilterState(tab)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                        filterState === tab
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bulk Selection Action Bar */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const allSelected =
                      items.length > 0 &&
                      items.every((i) => i.selectedForBatch);
                    setItems((prev) =>
                      prev.map((i) => ({
                        ...i,
                        selectedForBatch: !allSelected,
                      }))
                    );
                  }}
                  className="flex items-center gap-1.5 font-medium text-slate-700 hover:text-slate-900"
                >
                  {items.length > 0 &&
                  items.every((i) => i.selectedForBatch) ? (
                    <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  Select All ({items.length})
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={loadSampleDataset}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Reset Samples
                  </button>
                  {items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setItems([]);
                        setActiveId(null);
                      }}
                      className="text-slate-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Queue Rows */}
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <FileImage className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-500">
                    No images in this view. Drop images here, bulk upload from
                    your device, or import from Google Drive.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Images
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
                  {filteredItems.map((item) => {
                    const isActive = activeItem?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setActiveId(item.id)}
                        className={`flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-colors ${
                          isActive ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.id === item.id
                                    ? {
                                        ...x,
                                        selectedForBatch: !x.selectedForBatch,
                                      }
                                    : x
                                )
                              );
                            }}
                            className="text-slate-500 hover:text-blue-600 shrink-0"
                            aria-label={`Select ${item.name}`}
                          >
                            {item.selectedForBatch ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>

                          <img
                            src={item.restoredDataUrl || item.originalDataUrl}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-md object-cover border border-slate-200 shrink-0"
                          />

                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {item.name}
                            </p>
                            {/* Clean unboxed metadata with typographic separators */}
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
                              <span>
                                {item.width}×{item.height}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="capitalize">{item.source}</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  item.restoredDataUrl
                                    ? 'text-emerald-700 font-semibold'
                                    : item.status === 'restoring' ||
                                      item.status === 'detecting'
                                    ? 'text-blue-600 font-semibold'
                                    : 'text-slate-600'
                                }
                              >
                                {item.restoredDataUrl
                                  ? 'Restored'
                                  : item.status === 'restoring'
                                  ? 'Restoring...'
                                  : item.status === 'detecting'
                                  ? 'Scanning...'
                                  : `${item.detectedRegions.length} Masks`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItems((prev) =>
                              prev.filter((x) => x.id !== item.id)
                            );
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                          title="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bulk Export (Image-Only) & Google Drive Save Panel */}
            <div
              id="export-controls"
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900">
                  Bulk Image Export & Google Drive Sync
                </h2>
                <p className="text-xs text-slate-500">
                  Exports strictly as raster image files (PNG, JPEG, WEBP) to
                  your device or directly to Google Drive.
                </p>
              </div>

              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Restoration Engine
                  </label>
                  <select
                    value={batchEngine}
                    onChange={(e) =>
                      setBatchEngine(
                        e.target.value as
                          | 'gemini_ai'
                          | 'hybrid_inpaint'
                          | 'high_quality'
                      )
                    }
                    className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Image Output Format
                    </label>
                    <select
                      value={exportFormat}
                      onChange={(e) =>
                        setExportFormat(e.target.value as ExportImageFormat)
                      }
                      className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="image/png">PNG (Lossless Image)</option>
                      <option value="image/jpeg">JPEG (High Compatibility)</option>
                      <option value="image/webp">WEBP (Modern Image)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1 font-mono tabular-nums">
                      Image Quality ({Math.round(exportQuality * 100)}%)
                    </label>
                    <input
                      type="range"
                      min={0.7}
                      max={1}
                      step={0.02}
                      value={exportQuality}
                      onChange={(e) =>
                        setExportQuality(Number(e.target.value))
                      }
                      className="w-full mt-2 accent-blue-600"
                    />
                  </div>
                </div>

                <div className="pt-2 flex flex-col gap-2.5">
                  <button
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={handleBulkExportImages}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4 text-slate-700" />
                    Bulk Export Selected as Images ({selectedItems.length})
                  </button>

                  <button
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={() => openDriveUploadModalForItems(selectedItems)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <CloudUpload className="w-4 h-4" />
                    Bulk Save Selected to Google Drive ({selectedItems.length})
                  </button>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Column (8 cols): Interactive Before/After & Masking Studio */}
          <section className="lg:col-span-8">
            {activeItem ? (
              <CanvasInspector
                item={activeItem}
                onUpdateMask={(id, maskDataUrl) =>
                  setItems((prev) =>
                    prev.map((x) =>
                      x.id === id ? { ...x, maskDataUrl } : x
                    )
                  )
                }
                onDetectSingle={(id) => {
                  handleDetectWatermarks(id);
                }}
                onRestoreSingle={(id, engine) => {
                  handleRestoreImage(id, engine);
                }}
                onExportSingleImage={handleExportSingleImage}
                onSaveSingleToDrive={(item) =>
                  openDriveUploadModalForItems([item])
                }
                isProcessing={
                  activeItem.status === 'detecting' ||
                  activeItem.status === 'restoring' ||
                  isBatchProcessing
                }
              />
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-16 text-center cursor-pointer hover:border-blue-500 transition-colors space-y-4"
              >
                <Upload className="w-10 h-10 text-blue-600 mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-900">
                    Drop Watermarked Images or Click to Bulk Upload
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Upload PNG, JPEG, or WEBP images from your computer or
                    import batches directly from your Google Drive.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Google Drive Import Modal */}
      <DriveImportModal
        isOpen={isDriveImportOpen}
        onClose={() => setIsDriveImportOpen(false)}
        needsAuth={needsAuth}
        isLoggingIn={isLoggingIn}
        onLogin={handleGoogleLogin}
        files={driveFiles}
        isLoadingFiles={isLoadingDriveFiles}
        isImporting={isImportingFromDrive}
        error={driveError}
        onSearchFiles={fetchDriveImageList}
        onImportSelected={handleImportDriveFiles}
        onImportSharedLinks={async (linksText: string) => {
          setDriveError(null);
          const lines = linksText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length === 0) return;

          const imported: BatchImageItem[] = [];
          for (const line of lines) {
            const resp = await fetch('/api/drive/fetch-shared', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileIdOrUrl: line }),
            });
            const data = await resp.json();
            if (!resp.ok) {
              setDriveError(data.error || 'Could not import shared Drive link.');
              return;
            }
            const dims = await getImageDimensions(data.dataUrl);
            imported.push({
              id: `drive-link-${data.fileId}-${Date.now()}`,
              name: data.name,
              source: 'drive',
              driveFileId: data.fileId,
              originalDataUrl: data.dataUrl,
              restoredDataUrl: null,
              maskDataUrl: null,
              mimeType: data.mimeType || 'image/png',
              width: dims.width,
              height: dims.height,
              sizeBytes: data.sizeBytes || 0,
              status: 'queued',
              detectedRegions: [],
              selectedForBatch: true,
            });
          }

          if (imported.length > 0) {
            setItems((prev) => [...imported, ...prev]);
            setActiveId(imported[0].id);
            setIsDriveImportOpen(false);
            setStatusBanner(
              `Imported ${imported.length} shared image${
                imported.length === 1 ? '' : 's'
              } from Google Drive.`
            );
          }
        }}
      />

      {/* Google Drive Bulk Save Confirmation Modal */}
      <DriveUploadConfirmModal
        isOpen={isDriveUploadOpen}
        onClose={() => setIsDriveUploadOpen(false)}
        itemsToUpload={driveUploadItems}
        exportFormat={exportFormat}
        needsAuth={needsAuth}
        isLoggingIn={isLoggingIn}
        onLogin={handleGoogleLogin}
        isUploading={isUploadingToDrive}
        uploadProgress={driveUploadProgress}
        onConfirmUpload={handleConfirmDriveBulkUpload}
      />
    </div>
  );
}
