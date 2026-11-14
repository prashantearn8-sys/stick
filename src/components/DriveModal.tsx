import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  Folder,
  FolderOpen,
  Link2,
  RefreshCw,
  Search,
  Square,
  X,
} from 'lucide-react';
import { DriveFileItem, isDriveFolder } from '../lib/drive';
import { BatchImageItem } from './CanvasInspector';
import { ExportImageFormat } from '../lib/inpaint';

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled, label = 'Sign in with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="gsi-material-button"
  >
    <div className="gsi-material-button-state"></div>
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          style={{ display: 'block' }}
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          ></path>
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          ></path>
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          ></path>
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          ></path>
          <path fill="none" d="M0 0h48v48H0z"></path>
        </svg>
      </div>
      <span className="gsi-material-button-contents">{label}</span>
      <span style={{ display: 'none' }}>{label}</span>
    </div>
  </button>
);

export interface DriveImportProgress {
  completed: number;
  total: number;
  currentName?: string;
  phase?: 'scanning' | 'downloading';
}

interface DriveFolderCrumb {
  id: string;
  name: string;
}

interface DriveImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onLogin: () => void;
  files: DriveFileItem[];
  isLoadingFiles: boolean;
  isImporting: boolean;
  importProgress: DriveImportProgress;
  error: string | null;
  onSearchFiles: (query: string, folderId?: string) => void;
  onImportSelected: (selectedFiles: DriveFileItem[]) => void;
  onImportSharedLinks?: (linksText: string) => Promise<void>;
}

export const DriveImportModal: React.FC<DriveImportModalProps> = ({
  isOpen,
  onClose,
  needsAuth,
  isLoggingIn,
  onLogin,
  files,
  isLoadingFiles,
  isImporting,
  importProgress,
  error,
  onSearchFiles,
  onImportSelected,
  onImportSharedLinks,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemsMap, setSelectedItemsMap] = useState<
    Record<string, DriveFileItem>
  >({});
  const [folderPath, setFolderPath] = useState<DriveFolderCrumb[]>([]);
  const [sharedLinksInput, setSharedLinksInput] = useState('');
  const [isFetchingLinks, setIsFetchingLinks] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedItemsMap({});
      setFolderPath([]);
      setSearchQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentFolderId =
    folderPath.length > 0 ? folderPath[folderPath.length - 1].id : undefined;

  const toggleSelect = (file: DriveFileItem) => {
    setSelectedItemsMap((prev) => {
      const next = { ...prev };
      if (next[file.id]) {
        delete next[file.id];
      } else {
        next[file.id] = file;
      }
      return next;
    });
  };

  const selectedFiles = Object.values(selectedItemsMap);
  const selectedFoldersCount = selectedFiles.filter(isDriveFolder).length;
  const selectedImagesCount = selectedFiles.length - selectedFoldersCount;

  const allVisibleSelected =
    files.length > 0 && files.every((f) => Boolean(selectedItemsMap[f.id]));

  const handleSelectAll = () => {
    setSelectedItemsMap((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) {
        files.forEach((f) => {
          delete next[f.id];
        });
      } else {
        files.forEach((f) => {
          next[f.id] = f;
        });
      }
      return next;
    });
  };

  const handleOpenFolder = (folder: DriveFileItem) => {
    setSearchQuery('');
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    onSearchFiles('', folder.id);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    setSearchQuery('');
    if (index < 0) {
      setFolderPath([]);
      onSearchFiles('', undefined);
      return;
    }
    const nextPath = folderPath.slice(0, index + 1);
    setFolderPath(nextPath);
    onSearchFiles('', nextPath[nextPath.length - 1].id);
  };

  const handleSharedLinksSubmit = async () => {
    if (!onImportSharedLinks || !sharedLinksInput.trim()) return;
    setIsFetchingLinks(true);
    try {
      await onImportSharedLinks(sharedLinksInput);
      setSharedLinksInput('');
    } finally {
      setIsFetchingLinks(false);
    }
  };

  const isProgressActive = isImporting || isFetchingLinks;
  const progressPercent =
    importProgress.total > 0
      ? Math.min(
          100,
          Math.round((importProgress.completed / importProgress.total) * 100)
        )
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Upload Images or Folders from Google Drive
            </h3>
          </div>
          <button
            type="button"
            disabled={isProgressActive}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {needsAuth ? (
            <div className="space-y-5">
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-3.5">
                <p className="text-sm font-medium text-slate-800 max-w-md">
                  Connect your Google Drive account to browse your folders and
                  import or export batches of images directly.
                </p>
                <GoogleSignInButton
                  onClick={onLogin}
                  disabled={isLoggingIn}
                  label={isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
                />
              </div>

              {/* Step-by-step fix for stuck __/auth/handler or 403 Test User screen */}
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-slate-700 space-y-2">
                <p className="font-semibold text-slate-900">
                  Popup stuck on a blank `firebaseapp.com/__/auth/handler` page
                  or showing `Error 403: access_denied`?
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-600 leading-relaxed">
                  <li>
                    <strong>Close any open popup window</strong> first (reusing
                    a popup after switching accounts invalidates its state token
                    and leaves it blank).
                  </li>
                  <li>
                    Open your project&apos;s{' '}
                    <a
                      href="https://console.cloud.google.com/auth/audience?project=stickmuse"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 font-medium underline inline-flex items-center gap-1"
                    >
                      Google Cloud OAuth Audience Settings
                      <ExternalLink className="w-3 h-3" />
                    </a>{' '}
                    and either click <strong>Publish App</strong> OR add{' '}
                    <code className="px-1 py-0.5 bg-white rounded border border-amber-200">
                      burnster1826@gmail.com
                    </code>{' '}
                    and{' '}
                    <code className="px-1 py-0.5 bg-white rounded border border-amber-200">
                      prashantearn8@gmail.com
                    </code>{' '}
                    under <strong>Test users</strong> (Google requires test
                    users to be listed explicitly while in Testing mode).
                  </li>
                  <li>
                    Also verify your preview domain (
                    <code className="px-1 py-0.5 bg-white rounded border border-amber-200">
                      {window.location.hostname}
                    </code>
                    ) is listed under{' '}
                    <a
                      href="https://console.firebase.google.com/project/stickmuse/authentication/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 font-medium underline inline-flex items-center gap-1"
                    >
                      Firebase Auth &rarr; Settings &rarr; Authorized domains
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    .
                  </li>
                </ol>
              </div>

              {/* Alternative: Direct Shared Google Drive Link Import */}
              {onImportSharedLinks && (
                <div className="pt-2 border-t border-slate-200 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <Link2 className="w-4 h-4 text-blue-600" />
                    <span>
                      Instant Alternative: Import by Shared Google Drive Image
                      Link(s)
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Paste one or more Google Drive image share links (set to{' '}
                    <em>&ldquo;Anyone with the link&rdquo;</em>) — one per line
                    — to import them without opening a sign-in popup:
                  </p>
                  <textarea
                    rows={3}
                    value={sharedLinksInput}
                    onChange={(e) => setSharedLinksInput(e.target.value)}
                    placeholder="https://drive.google.com/file/d/1abc123.../view?usp=sharing"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {error && (
                    <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      {error}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!sharedLinksInput.trim() || isFetchingLinks}
                      onClick={handleSharedLinksSubmit}
                      className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <CloudDownload className="w-3.5 h-3.5" />
                      {isFetchingLinks
                        ? 'Importing Links...'
                        : 'Import Shared Drive Link(s)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Search & Refresh Bar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSearchFiles(searchQuery, currentFolderId);
                      }
                    }}
                    placeholder="Search folders or images in your Google Drive..."
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onSearchFiles(searchQuery, currentFolderId)}
                  disabled={isLoadingFiles || isProgressActive}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isLoadingFiles ? 'animate-spin' : ''
                    }`}
                  />
                  Search
                </button>
                {files.length > 0 && (
                  <button
                    type="button"
                    disabled={isProgressActive}
                    onClick={handleSelectAll}
                    className="px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {allVisibleSelected ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>

              {/* Folder Breadcrumbs */}
              <div className="flex items-center flex-wrap gap-1 text-xs text-slate-600">
                <button
                  type="button"
                  disabled={isProgressActive}
                  onClick={() => handleNavigateBreadcrumb(-1)}
                  className={`px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer ${
                    folderPath.length === 0
                      ? 'font-semibold text-slate-900 bg-slate-100'
                      : 'text-blue-700'
                  }`}
                >
                  Google Drive
                </button>
                {folderPath.map((crumb, idx) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    <button
                      type="button"
                      disabled={isProgressActive}
                      onClick={() => handleNavigateBreadcrumb(idx)}
                      className={`px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer ${
                        idx === folderPath.length - 1
                          ? 'font-semibold text-slate-900 bg-slate-100'
                          : 'text-blue-700'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
                <span className="ml-auto text-[11px] text-slate-500">
                  Tip: Check a folder to import all images inside it
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}

              {/* File & Folder List */}
              {isLoadingFiles ? (
                <div className="space-y-2 py-6">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-12 bg-slate-100 animate-pulse rounded-lg"
                    />
                  ))}
                </div>
              ) : files.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  No folders or image files found in this Google Drive location.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-80 overflow-y-auto">
                  {files.map((file) => {
                    const isFolder = isDriveFolder(file);
                    const isChecked = Boolean(selectedItemsMap[file.id]);
                    const sizeKb = file.size
                      ? `${Math.round(Number(file.size) / 1024)} KB`
                      : 'Image';
                    return (
                      <div
                        key={file.id}
                        onClick={() => !isProgressActive && toggleSelect(file)}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                          isChecked ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          {isFolder ? (
                            <div className="w-8 h-8 rounded bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                              <Folder className="w-4 h-4 text-amber-600" />
                            </div>
                          ) : file.thumbnailLink ? (
                            <img
                              src={file.thumbnailLink}
                              alt={file.name}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-slate-900 truncate block">
                              {file.name}
                            </span>
                            {isFolder && (
                              <span className="text-[11px] text-slate-500">
                                Folder (imports all images inside)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums shrink-0">
                          {isFolder ? (
                            <button
                              type="button"
                              disabled={isProgressActive}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenFolder(file);
                              }}
                              className="px-2.5 py-1 text-xs font-sans font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                            >
                              Open
                            </button>
                          ) : (
                            <>
                              <span>{sizeKb}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {file.mimeType
                                  .replace('image/', '')
                                  .toUpperCase()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Upload/Import Progress Bar */}
          {isProgressActive && (
            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-800">
                <span className="truncate">
                  {importProgress.phase === 'scanning'
                    ? `Scanning folder "${importProgress.currentName || ''}" for images...`
                    : importProgress.currentName
                    ? `Uploading from Drive: ${importProgress.currentName}`
                    : 'Uploading images from Google Drive...'}
                </span>
                <span className="font-mono tabular-nums text-blue-700 shrink-0">
                  {importProgress.phase === 'scanning'
                    ? 'Preparing...'
                    : `${importProgress.completed} / ${importProgress.total} (${progressPercent}%)`}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-blue-600 transition-all duration-200 ${
                    importProgress.phase === 'scanning'
                      ? 'w-1/3 animate-pulse'
                      : ''
                  }`}
                  style={
                    importProgress.phase === 'scanning'
                      ? undefined
                      : { width: `${progressPercent}%` }
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <span className="text-xs text-slate-600 font-mono tabular-nums">
            {selectedFoldersCount > 0 && selectedImagesCount > 0
              ? `${selectedFoldersCount} folder${
                  selectedFoldersCount === 1 ? '' : 's'
                }, ${selectedImagesCount} image${
                  selectedImagesCount === 1 ? '' : 's'
                } selected`
              : selectedFoldersCount > 0
              ? `${selectedFoldersCount} folder${
                  selectedFoldersCount === 1 ? '' : 's'
                } selected`
              : `${selectedImagesCount} image${
                  selectedImagesCount === 1 ? '' : 's'
                } selected`}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isProgressActive}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            {!needsAuth && (
              <button
                type="button"
                disabled={selectedFiles.length === 0 || isProgressActive}
                onClick={() => onImportSelected(selectedFiles)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                <CloudDownload className="w-4 h-4" />
                {isImporting
                  ? importProgress.phase === 'scanning'
                    ? 'Scanning Folder...'
                    : `Uploading (${importProgress.completed}/${importProgress.total})...`
                  : selectedFoldersCount > 0 && selectedImagesCount === 0
                  ? `Import Folder${selectedFoldersCount === 1 ? '' : 's'} (${selectedFoldersCount})`
                  : `Import Selected (${selectedFiles.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface DriveUploadConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemsToUpload: BatchImageItem[];
  exportFormat: ExportImageFormat;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onLogin: () => void;
  isUploading: boolean;
  uploadProgress: { completed: number; total: number };
  onConfirmUpload: () => void;
}

export const DriveUploadConfirmModal: React.FC<DriveUploadConfirmModalProps> = ({
  isOpen,
  onClose,
  itemsToUpload,
  exportFormat,
  needsAuth,
  isLoggingIn,
  onLogin,
  isUploading,
  uploadProgress,
  onConfirmUpload,
}) => {
  if (!isOpen) return null;

  const formatLabel = exportFormat.replace('image/', '').toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <CloudUpload className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Confirm Bulk Save to Google Drive
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {needsAuth ? (
            <div className="py-6 text-center flex flex-col items-center gap-4">
              <p className="text-sm text-slate-600">
                Please sign in with Google to authorize saving exported images
                to your Google Drive.
              </p>
              <GoogleSignInButton
                onClick={onLogin}
                disabled={isLoggingIn}
                label={isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
              />
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600 leading-relaxed">
                You are about to create a new folder named{' '}
                <strong className="text-slate-900 font-mono">draft2</strong> in
                your Google Drive and export{' '}
                <strong className="text-slate-900 font-mono tabular-nums">
                  {itemsToUpload.length}
                </strong>{' '}
                image file{itemsToUpload.length === 1 ? '' : 's'} ({formatLabel})
                with the exact original filename{itemsToUpload.length === 1 ? '' : 's'}. Please confirm to proceed:
              </p>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-48 overflow-y-auto bg-slate-50/50">
                {itemsToUpload.map((item) => (
                  <div
                    key={item.id}
                    className="px-3.5 py-2 flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-slate-800 truncate max-w-xs">
                      draft2/{item.name}
                    </span>
                    <span className="text-slate-500 font-mono tabular-nums">
                      {item.restoredDataUrl ? 'Restored Image' : 'Original Image'}
                    </span>
                  </div>
                ))}
              </div>

              {isUploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono tabular-nums text-slate-600">
                    <span>Uploading to Google Drive...</span>
                    <span>
                      {uploadProgress.completed} / {uploadProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-transform duration-150"
                      style={{
                        width: `${
                          uploadProgress.total > 0
                            ? Math.round(
                                (uploadProgress.completed /
                                  uploadProgress.total) *
                                  100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            disabled={isUploading}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          {!needsAuth && (
            <button
              type="button"
              disabled={isUploading || itemsToUpload.length === 0}
              onClick={onConfirmUpload}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <CloudUpload className="w-4 h-4" />
              {isUploading
                ? 'Saving to Drive...'
                : `Confirm Save (${itemsToUpload.length}) to Drive`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
