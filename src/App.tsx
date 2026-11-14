/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  CloudDownload,
  CloudUpload,
  Download,
  FileImage,
  Layers,
  LogOut,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  getAccessToken,
  getRememberedUser,
  googleSignIn,
  initAuth,
  logout,
  markJobExportedToDriveInFirestore,
  RememberedUserInfo,
  saveRestorationJobToFirestore,
} from './lib/auth';
import {
  createDriveFolder,
  downloadDriveImageAsDataUrl,
  DriveFileItem,
  getImageDimensions,
  listDriveImages,
  uploadImageToDrive,
} from './lib/drive';
import {
  convertImageForExport,
  ExportImageFormat,
  performContentAwareInpaint,
  refineBottomRightGeminiRegion,
  triggerBlobDownload,
  WatermarkRegion,
} from './lib/inpaint';
import { BatchImageItem } from './components/CanvasInspector';
import {
  DriveImportModal,
  DriveUploadConfirmModal,
  GoogleSignInButton,
} from './components/DriveModal';

// Always export as Lossless PNG at 100% quality (hidden from frontend UI per user specification)
const EXPORT_FORMAT: ExportImageFormat = 'image/png';
const EXPORT_QUALITY = 1.0;

const DEFAULT_BOTTOM_RIGHT_GEMINI_REGION: WatermarkRegion = {
  label: 'Bottom-Right Gemini Sparkle',
  ymin: 905,
  xmin: 932,
  ymax: 974,
  xmax: 982,
};

const MAX_DETECT_HISTORY = 30;

// Snapshot of ONLY AI Watermark Detection state per image ID (never affects uploaded files)
interface DetectionStateEntry {
  status: BatchImageItem['status'];
  detectedRegions: WatermarkRegion[];
  watermarkType?: string;
  estimatedOpacity?: number;
  restorationStrategy?: string;
}

type DetectionHistorySnapshot = Record<string, DetectionStateEntry>;

export default function App() {
  // Auth & Google Drive state — immediately hydrated from localStorage so signed-in user is remembered across reloads
  const [rememberedUser, setRememberedUser] =
    useState<RememberedUserInfo | null>(() => getRememberedUser());
  const [user, setUser] = useState<User | null>(null);
  const [needsDriveAuth, setNeedsDriveAuth] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Batch Queue & Active Image Selection (Unlimited images supported, no preloaded sample data)
  const [items, setItems] = useState<BatchImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueSearch, setQueueSearch] = useState<string>('');
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Undo / Redo History Stacks strictly for Detect Watermarks (AI)
  const [detectUndoStack, setDetectUndoStack] = useState<
    DetectionHistorySnapshot[]
  >([]);
  const [detectRedoStack, setDetectRedoStack] = useState<
    DetectionHistorySnapshot[]
  >([]);

  // Apply to All is default ON
  const [applyToAll] = useState<boolean>(true);

  // Processing & Status State (Single Unified Best AI Engine)
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

  // Capture current detection state across images (does NOT touch uploaded image list)
  const captureDetectionSnapshot = useCallback(
    (currentItems: BatchImageItem[]): DetectionHistorySnapshot => {
      const snap: DetectionHistorySnapshot = {};
      for (const item of currentItems) {
        snap[item.id] = {
          status:
            item.status === 'detecting'
              ? item.detectedRegions.length > 0
                ? 'detected'
                : 'queued'
              : item.status,
          detectedRegions: item.detectedRegions.map((r) => ({ ...r })),
          watermarkType: item.watermarkType,
          estimatedOpacity: item.estimatedOpacity,
          restorationStrategy: item.restorationStrategy,
        };
      }
      return snap;
    },
    []
  );

  const pushDetectUndoSnapshot = useCallback(
    (currentItems: BatchImageItem[]) => {
      const snap = captureDetectionSnapshot(currentItems);
      setDetectUndoStack((prev) => [
        ...prev.slice(-(MAX_DETECT_HISTORY - 1)),
        snap,
      ]);
      setDetectRedoStack([]);
    },
    [captureDetectionSnapshot]
  );

  // Undo Detect Watermarks (AI) — never removes or modifies uploaded images
  const handleUndoDetect = useCallback(() => {
    if (detectUndoStack.length === 0 || isBatchProcessing) return;
    const previousSnap = detectUndoStack[detectUndoStack.length - 1];
    const currentSnap = captureDetectionSnapshot(items);

    setDetectUndoStack((prev) => prev.slice(0, -1));
    setDetectRedoStack((prev) => [
      ...prev.slice(-(MAX_DETECT_HISTORY - 1)),
      currentSnap,
    ]);

    setItems((prevItems) =>
      prevItems.map((item) => {
        const entry = previousSnap[item.id];
        if (!entry) return item;
        return {
          ...item,
          status: item.restoredDataUrl ? 'restored' : entry.status,
          detectedRegions: entry.detectedRegions.map((r) => ({ ...r })),
          watermarkType: entry.watermarkType,
          estimatedOpacity: entry.estimatedOpacity,
          restorationStrategy: entry.restorationStrategy,
        };
      })
    );
    setStatusBanner('Undid Detect Watermarks (AI).');
  }, [detectUndoStack, items, isBatchProcessing, captureDetectionSnapshot]);

  // Redo Detect Watermarks (AI) — never removes or modifies uploaded images
  const handleRedoDetect = useCallback(() => {
    if (detectRedoStack.length === 0 || isBatchProcessing) return;
    const nextSnap = detectRedoStack[detectRedoStack.length - 1];
    const currentSnap = captureDetectionSnapshot(items);

    setDetectRedoStack((prev) => prev.slice(0, -1));
    setDetectUndoStack((prev) => [
      ...prev.slice(-(MAX_DETECT_HISTORY - 1)),
      currentSnap,
    ]);

    setItems((prevItems) =>
      prevItems.map((item) => {
        const entry = nextSnap[item.id];
        if (!entry) return item;
        return {
          ...item,
          status: item.restoredDataUrl ? 'restored' : entry.status,
          detectedRegions: entry.detectedRegions.map((r) => ({ ...r })),
          watermarkType: entry.watermarkType,
          estimatedOpacity: entry.estimatedOpacity,
          restorationStrategy: entry.restorationStrategy,
        };
      })
    );
    setStatusBanner('Redid Detect Watermarks (AI).');
  }, [detectRedoStack, items, isBatchProcessing, captureDetectionSnapshot]);

  // Keyboard shortcuts for Undo/Redo of Detect Watermarks (AI)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedoDetect();
        } else {
          e.preventDefault();
          handleUndoDetect();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedoDetect();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndoDetect, handleRedoDetect]);

  // Initialize Firebase Auth listener & persist signed-in user across reloads
  useEffect(() => {
    const unsubscribeAuth = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setRememberedUser({
          uid: authedUser.uid,
          email: authedUser.email,
          displayName: authedUser.displayName,
          photoURL: authedUser.photoURL,
        });
        setNeedsDriveAuth(!token);
      },
      () => {
        setUser(null);
        setRememberedUser(null);
        setNeedsDriveAuth(true);
      }
    );

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Google Sign-In handler
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setRememberedUser({
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName,
          photoURL: result.user.photoURL,
        });
        setNeedsDriveAuth(false);
        setStatusBanner('Signed in with Google and connected to Google Drive.');
        if (isDriveImportOpen) {
          await fetchDriveImageList('');
        }
      } else {
        setStatusBanner(
          'Sign-in window was closed. Click "Sign in with Google" whenever you are ready.'
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
    setRememberedUser(null);
    setNeedsDriveAuth(true);
  };

  // Unlimited Local Image Upload handler (does NOT push to Undo/Redo stack)
  const handleFilesSelected = async (
    fileList: FileList | File[] | null
  ): Promise<void> => {
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name)
    );
    if (filesArray.length === 0) return;

    setStatusBanner(
      `Loading ${filesArray.length} Gemini generated image${
        filesArray.length === 1 ? '' : 's'
      }...`
    );

    const CHUNK_SIZE = 15;
    let firstAddedId: string | null = null;
    const timestamp = Date.now();

    for (let start = 0; start < filesArray.length; start += CHUNK_SIZE) {
      const slice = filesArray.slice(start, start + CHUNK_SIZE);
      const chunkItems = await Promise.all(
        slice.map(async (file, idx) => {
          const globalIdx = start + idx;
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const dims = await getImageDimensions(dataUrl);
          return {
            id: `local_${timestamp}_${globalIdx}`,
            name: file.name,
            source: 'local' as const,
            originalDataUrl: dataUrl,
            restoredDataUrl: null,
            maskDataUrl: null,
            mimeType: file.type || 'image/png',
            width: dims.width,
            height: dims.height,
            sizeBytes: file.size,
            status: 'queued' as const,
            detectedRegions: [],
            selectedForBatch: true,
          };
        })
      );

      if (!firstAddedId && chunkItems.length > 0) {
        firstAddedId = chunkItems[0].id;
      }

      setItems((prev) => [...prev, ...chunkItems]);
      await new Promise((r) => setTimeout(r, 0));
    }

    if (firstAddedId && !activeId) {
      setActiveId(firstAddedId);
    } else if (firstAddedId && items.length === 0) {
      setActiveId(firstAddedId);
    }

    setStatusBanner(
      `Added ${filesArray.length} image${
        filesArray.length === 1 ? '' : 's'
      } to the workspace queue.`
    );
  };

  // Single Image Bottom-Right Gemini Watermark Detection
  const detectWatermarksForItem = async (
    target: BatchImageItem
  ): Promise<WatermarkRegion[]> => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
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

      const data = await response.json().catch(() => ({}));
      const aiRegions: WatermarkRegion[] =
        Array.isArray(data.regions) && data.regions.length > 0
          ? data.regions
          : [DEFAULT_BOTTOM_RIGHT_GEMINI_REGION];

      // Refine the bottom-right Gemini sparkle coordinates directly against the image pixels
      const refinedBottomRight = await refineBottomRightGeminiRegion(
        target.originalDataUrl,
        aiRegions
      );
      const regions = [refinedBottomRight];

      const wmType =
        data.watermarkType || 'Bottom-Right Gemini 4-Point Sparkle';

      setItems((prev) =>
        prev.map((item) =>
          item.id === target.id
            ? {
                ...item,
                status: item.restoredDataUrl ? 'restored' : 'detected',
                detectedRegions: regions,
                watermarkType: wmType,
                estimatedOpacity:
                  typeof data.estimatedOpacity === 'number'
                    ? data.estimatedOpacity
                    : 55,
                restorationStrategy:
                  data.restorationStrategy ||
                  'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
              }
            : item
        )
      );

      await saveRestorationJobToFirestore({
        jobId: target.id,
        fileName: target.name,
        source: target.source,
        width: target.width,
        height: target.height,
        regionCount: regions.length,
        watermarkType: wmType,
        restorationMethod: 'Bottom-Right Gemini Sparkle Detected',
        status: 'detected',
        driveFileId: target.driveFileId,
      });

      return regions;
    } catch (err: any) {
      const fallbackRegion = await refineBottomRightGeminiRegion(
        target.originalDataUrl,
        [DEFAULT_BOTTOM_RIGHT_GEMINI_REGION]
      ).catch(() => DEFAULT_BOTTOM_RIGHT_GEMINI_REGION);
      const fallbackRegions = [fallbackRegion];

      setItems((prev) =>
        prev.map((item) =>
          item.id === target.id
            ? {
                ...item,
                status: item.restoredDataUrl ? 'restored' : 'detected',
                detectedRegions: fallbackRegions,
                watermarkType: 'Bottom-Right Gemini 4-Point Sparkle',
                restorationStrategy:
                  'Bottom-right corner sparkle isolation and structure-preserving pixel reconstruction',
                errorMessage: err?.message,
              }
            : item
        )
      );
      return fallbackRegions;
    }
  };

  // Detect Watermarks (AI) on Single Page — records Undo snapshot strictly for detection
  const handleDetectWatermarks = async (
    id: string
  ): Promise<WatermarkRegion[]> => {
    const target = items.find((i) => i.id === id);
    if (!target) return [];
    pushDetectUndoSnapshot(items);
    const regions = await detectWatermarksForItem(target);
    setStatusBanner(`Detected bottom-right Gemini watermark on ${target.name}.`);
    return regions;
  };

  // Single Image Bottom-Right Gemini Watermark Removal & Restoration (Unified Best AI Engine)
  const restoreSingleItem = async (target: BatchImageItem): Promise<void> => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? { ...item, status: 'restoring', errorMessage: undefined }
          : item
      )
    );

    let activeRegions = target.detectedRegions;
    if (activeRegions.length === 0) {
      activeRegions = await detectWatermarksForItem(target);
    }

    try {
      const base64 = target.originalDataUrl.split(',')[1];
      const response = await fetch('/api/watermark/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: target.mimeType || 'image/png',
          mode: 'high_quality',
          detectedRegions: activeRegions,
        }),
      });

      const data = await response.json().catch(() => ({}));
      const refinedRegions: WatermarkRegion[] =
        Array.isArray(data?.regions) && data.regions.length > 0
          ? data.regions
          : activeRegions.length > 0
          ? activeRegions
          : [DEFAULT_BOTTOM_RIGHT_GEMINI_REGION];

      const restoredDataUrl = await performContentAwareInpaint(
        target.originalDataUrl,
        refinedRegions,
        null
      );

      const methodLabel =
        'AI-Guided Structure-Preserving Inpaint (Gemini AI)';
      const wmType =
        data?.watermarkType ||
        target.watermarkType ||
        'Bottom-Right Gemini 4-Point Sparkle';

      setItems((prev) =>
        prev.map((item) =>
          item.id === target.id
            ? {
                ...item,
                status: 'restored',
                detectedRegions: refinedRegions,
                watermarkType: wmType,
                estimatedOpacity:
                  typeof data?.estimatedOpacity === 'number'
                    ? data.estimatedOpacity
                    : item.estimatedOpacity,
                restorationStrategy:
                  data?.restorationStrategy || item.restorationStrategy,
                restoredDataUrl,
                restorationMethod: methodLabel,
              }
            : item
        )
      );

      await saveRestorationJobToFirestore({
        jobId: target.id,
        fileName: target.name,
        source: target.source,
        width: target.width,
        height: target.height,
        regionCount: refinedRegions.length,
        watermarkType: wmType,
        restorationMethod: methodLabel,
        status: 'restored',
        driveFileId: target.driveFileId,
      });
    } catch (_err: any) {
      const fallbackRegions =
        activeRegions.length > 0
          ? activeRegions
          : [DEFAULT_BOTTOM_RIGHT_GEMINI_REGION];
      const fallbackDataUrl = await performContentAwareInpaint(
        target.originalDataUrl,
        fallbackRegions,
        null
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === target.id
            ? {
                ...item,
                status: 'restored',
                detectedRegions: fallbackRegions,
                restoredDataUrl: fallbackDataUrl,
                restorationMethod: 'AI-Guided Structure-Preserving Inpaint',
              }
            : item
        )
      );
    }
  };

  const handleRestoreImage = async (id: string): Promise<void> => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    if (target.detectedRegions.length === 0) {
      pushDetectUndoSnapshot(items);
    }
    await restoreSingleItem(target);
    setStatusBanner(
      `Removed bottom-right Gemini watermark from ${target.name}.`
    );
  };

  // Batch Restore Selected Images (or all if Apply to All is ON)
  const handleBatchRestoreSelected = async () => {
    const selected = items.filter((i) => i.selectedForBatch);
    const targets = applyToAll
      ? items
      : selected.length > 0
      ? selected
      : items;
    if (targets.length === 0) return;

    if (targets.some((i) => i.detectedRegions.length === 0)) {
      pushDetectUndoSnapshot(items);
    }
    setIsBatchProcessing(true);
    for (let idx = 0; idx < targets.length; idx++) {
      const item = targets[idx];
      setStatusBanner(
        `Removing bottom-right Gemini watermark (${idx + 1} of ${
          targets.length
        }: ${item.name})...`
      );
      await restoreSingleItem(item);
    }
    setIsBatchProcessing(false);
    setStatusBanner(
      `Removed bottom-right Gemini watermark across ${targets.length} image${
        targets.length === 1 ? '' : 's'
      }.`
    );
  };

  // Export Single Image (Always Lossless PNG at 100% quality)
  const handleExportSingleImage = async (item: BatchImageItem) => {
    try {
      const sourceUrl = item.restoredDataUrl || item.originalDataUrl;
      const { blob, extension } = await convertImageForExport(
        sourceUrl,
        EXPORT_FORMAT,
        EXPORT_QUALITY
      );
      const cleanBaseName = item.name.replace(/\.[^/.]+$/, '');
      const fileName = `restored_${cleanBaseName}.${extension}`;
      triggerBlobDownload(blob, fileName);
      setStatusBanner(`Exported lossless PNG: ${fileName}`);
    } catch (err: any) {
      setStatusBanner(
        `Export error: ${err?.message || 'Could not export image.'}`
      );
    }
  };

  // Bulk Export Images (Always Lossless PNG at 100% quality)
  const handleBulkExportImages = async () => {
    const selected = items.filter((i) => i.selectedForBatch);
    const targets = selected.length > 0 ? selected : items;
    if (targets.length === 0) return;

    setStatusBanner(
      `Exporting ${targets.length} lossless PNG image${
        targets.length === 1 ? '' : 's'
      } (100% quality)...`
    );

    for (let i = 0; i < targets.length; i++) {
      await handleExportSingleImage(targets[i]);
      await new Promise((r) => setTimeout(r, 220));
    }

    setStatusBanner(
      `Exported ${targets.length} lossless PNG image${
        targets.length === 1 ? '' : 's'
      } to your device.`
    );
  };

  // Google Drive: Open Import Modal & Fetch Drive Images
  const handleOpenDriveImport = async () => {
    setIsDriveImportOpen(true);
    setDriveError(null);
    const token = await getAccessToken();
    if (!token) {
      setNeedsDriveAuth(true);
      return;
    }
    setNeedsDriveAuth(false);
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
        setNeedsDriveAuth(true);
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
          id: `drive_${df.id}_${Date.now()}_${i}`,
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

      setItems((prev) => [...prev, ...imported]);
      if (imported.length > 0 && !activeId) {
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
        setNeedsDriveAuth(true);
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
    setNeedsDriveAuth(!token);
    setDriveUploadItems(targetItems);
    setDriveUploadProgress({ completed: 0, total: targetItems.length });
    setIsDriveUploadOpen(true);
  };

  const handleConfirmDriveBulkUpload = async () => {
    if (driveUploadItems.length === 0) return;
    setIsUploadingToDrive(true);
    setDriveUploadProgress({ completed: 0, total: driveUploadItems.length });

    try {
      const folder = await createDriveFolder('draft2');

      for (let i = 0; i < driveUploadItems.length; i++) {
        const item = driveUploadItems[i];
        const sourceUrl = item.restoredDataUrl || item.originalDataUrl;
        const { dataUrl } = await convertImageForExport(
          sourceUrl,
          EXPORT_FORMAT,
          EXPORT_QUALITY
        );

        const uploaded = await uploadImageToDrive(
          item.name,
          dataUrl,
          EXPORT_FORMAT,
          folder.id
        );
        await markJobExportedToDriveInFirestore(item.id, uploaded.id, {
          fileName: item.name,
          source: item.source,
          width: item.width,
          height: item.height,
          regionCount: item.detectedRegions.length,
        });

        setDriveUploadProgress({
          completed: i + 1,
          total: driveUploadItems.length,
        });
      }

      setIsDriveUploadOpen(false);
      setStatusBanner(
        `Saved ${driveUploadItems.length} image${
          driveUploadItems.length === 1 ? '' : 's'
        } into new Google Drive folder "draft2" with original filenames.`
      );
    } catch (err: any) {
      if (err?.message === 'AUTH_REQUIRED') {
        setNeedsDriveAuth(true);
      } else {
        setStatusBanner(
          `Google Drive upload error: ${err?.message || 'Upload failed'}`
        );
      }
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const activeUserDisplay = user || rememberedUser;
  const selectedItems = items.filter((i) => i.selectedForBatch);

  const filteredItems = items.filter((item) => {
    if (
      queueSearch.trim() &&
      !item.name.toLowerCase().includes(queueSearch.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 text-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          handleFilesSelected(e.dataTransfer.files);
        }
      }}
    >
      {/* Clean Studio Header (Remembers Signed-In User Across Reloads) */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30">
        <a
          href="#workspace"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ClearSlate Studio
        </a>

        <div className="flex items-center gap-3 shrink-0">
          {!activeUserDisplay ? (
            <GoogleSignInButton
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              label={isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
            />
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg whitespace-nowrap shrink-0">
                {activeUserDisplay.photoURL ? (
                  <img
                    src={activeUserDisplay.photoURL}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <span>
                  {activeUserDisplay.email ||
                    activeUserDisplay.displayName ||
                    'Signed In'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hidden Multi-File Input for Unlimited Local Bulk Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Main Centered Studio Workspace */}
      <main
        id="workspace"
        className="flex-1 max-w-[1140px] w-full mx-auto px-6 py-8 space-y-6"
      >
        {/* Top Studio Pipeline Header */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Bottom-Right Gemini Watermark Remover
              </h1>
              {statusBanner && (
                <p className="text-xs text-blue-700 font-medium">
                  {statusBanner}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-blue-600" />
                Upload Unlimited Images
              </button>

              <button
                type="button"
                onClick={handleOpenDriveImport}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CloudDownload className="w-4 h-4 text-blue-600" />
                Import from Google Drive
              </button>

              <button
                type="button"
                disabled={isBatchProcessing || items.length === 0}
                onClick={handleBatchRestoreSelected}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                {isBatchProcessing
                  ? 'Removing Watermarks...'
                  : `Remove Watermark All (${items.length})`}
              </button>
            </div>
          </div>
        </section>

        {/* High-Density Batch Queue */}
        <section id="batch-queue" className="space-y-4">
          {/* Batch Queue Table Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Gemini Image Batch Queue ({items.length})
                </h2>
              </div>

              {items.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Search filename..."
                      className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
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
                  className="flex items-center gap-1.5 font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
                >
                  {items.length > 0 &&
                  items.every((i) => i.selectedForBatch) ? (
                    <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  Select All ({selectedItems.length}/{items.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setItems([]);
                    setActiveId(null);
                  }}
                  className="text-slate-500 hover:text-red-600 flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Queue
                </button>
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <FileImage className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-500">
                  {items.length === 0
                    ? 'No images uploaded yet. Upload unlimited Gemini-generated images to remove the bottom-right Gemini watermark.'
                    : 'No images match the current filter.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[480px] overflow-y-auto">
                {filteredItems.map((item) => {
                  const pageNumber =
                    items.findIndex((x) => x.id === item.id) + 1;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50 transition-colors"
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
                          className="text-slate-500 hover:text-blue-600 shrink-0 cursor-pointer"
                          aria-label={`Select ${item.name}`}
                        >
                          {item.selectedForBatch ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>

                        <span className="text-xs font-mono tabular-nums text-slate-400 w-7 shrink-0">
                          #{pageNumber}
                        </span>

                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate max-w-xs sm:max-w-md">
                            {item.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
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
                                  : item.status === 'restoring' ||
                                    item.status === 'detecting'
                                  ? 'text-blue-600 font-semibold'
                                  : item.detectedRegions.length > 0
                                  ? 'text-blue-700 font-medium'
                                  : 'text-slate-500'
                              }
                            >
                              {item.restoredDataUrl
                                ? 'Bottom-Right Watermark Removed'
                                : item.status === 'restoring'
                                ? 'Removing Watermark...'
                                : item.status === 'detecting'
                                ? 'Detecting Bottom-Right Sparkle...'
                                : item.detectedRegions.length > 0
                                ? 'Bottom-Right Sparkle Detected'
                                : 'Queued'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={
                            item.status === 'detecting' ||
                            item.status === 'restoring' ||
                            isBatchProcessing
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDetectWatermarks(item.id);
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Detect
                        </button>

                        <button
                          type="button"
                          disabled={
                            item.status === 'detecting' ||
                            item.status === 'restoring' ||
                            isBatchProcessing
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestoreImage(item.id);
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {item.restoredDataUrl ? 'Re-Run' : 'Remove Watermark'}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItems((prev) =>
                              prev.filter((x) => x.id !== item.id)
                            );
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0 cursor-pointer"
                          title="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Bulk Image Export & Cloud Sync Panel */}
        <section
          id="export-controls"
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">
              Bulk Image Export & Cloud Sync
            </h2>
            <p className="text-xs text-slate-500">
              Download restored images to your device or save batches directly
              into a new draft2 folder in Google Drive.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              disabled={items.length === 0}
              onClick={handleBulkExportImages}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-700" />
              Bulk Export as Images (
              {selectedItems.length > 0 ? selectedItems.length : items.length})
            </button>

            <button
              type="button"
              disabled={items.length === 0}
              onClick={() =>
                openDriveUploadModalForItems(
                  selectedItems.length > 0 ? selectedItems : items
                )
              }
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" />
              Bulk Save to Google Drive (
              {selectedItems.length > 0 ? selectedItems.length : items.length})
            </button>
          </div>
        </section>
      </main>

      {/* Google Drive Import Modal */}
      <DriveImportModal
        isOpen={isDriveImportOpen}
        onClose={() => setIsDriveImportOpen(false)}
        needsAuth={needsDriveAuth}
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
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
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
              id: `drive_link_${data.fileId}_${Date.now()}_${i}`,
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
            setItems((prev) => [...prev, ...imported]);
            if (!activeId) {
              setActiveId(imported[0].id);
            }
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
        exportFormat={EXPORT_FORMAT}
        needsAuth={needsDriveAuth}
        isLoggingIn={isLoggingIn}
        onLogin={handleGoogleLogin}
        isUploading={isUploadingToDrive}
        uploadProgress={driveUploadProgress}
        onConfirmUpload={handleConfirmDriveBulkUpload}
      />
    </div>
  );
}
