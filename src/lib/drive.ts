import { clearCachedAccessToken, getAccessToken } from './auth';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  webViewLink?: string;
}

/**
 * Lists image files from the user's Google Drive with automatic pagination for unlimited image batches.
 */
export async function listDriveImages(
  searchQuery = '',
  pageSize = 100
): Promise<DriveFileItem[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  let q = "mimeType contains 'image/' and trashed = false";
  if (searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }

  const allFiles: DriveFileItem[] = [];
  let pageToken: string | undefined = undefined;
  let pagesFetched = 0;

  do {
    const params = new URLSearchParams({
      q,
      pageSize: String(pageSize),
      orderBy: 'modifiedTime desc',
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (res.status === 401 || res.status === 403) {
      clearCachedAccessToken();
      throw new Error('AUTH_REQUIRED');
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        errData?.error?.message || 'Failed to fetch images from Google Drive.'
      );
    }

    const data = await res.json();
    if (Array.isArray(data.files)) {
      allFiles.push(...data.files);
    }
    pageToken = data.nextPageToken;
    pagesFetched++;
  } while (pageToken && pagesFetched < 10);

  return allFiles;
}

/**
 * Downloads an image file blob from Google Drive and converts it to a data URL.
 */
export async function downloadDriveImageAsDataUrl(
  fileId: string,
  mimeType: string
): Promise<{ dataUrl: string; sizeBytes: number; width: number; height: number }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    clearCachedAccessToken();
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status})`);
  }

  const blob = await res.blob();
  const finalMime = blob.type || mimeType || 'image/png';

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([blob], { type: finalMime }));
  });

  const dimensions = await getImageDimensions(dataUrl);

  return {
    dataUrl,
    sizeBytes: blob.size,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Creates a new folder in the user's Google Drive.
 */
export async function createDriveFolder(
  folderName: string
): Promise<{ id: string; name: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );

  if (res.status === 401 || res.status === 403) {
    clearCachedAccessToken();
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message ||
        `Failed to create folder "${folderName}" in Google Drive.`
    );
  }

  return await res.json();
}

/**
 * Uploads a single exported image (from dataUrl) to the user's Google Drive.
 */
export async function uploadImageToDrive(
  fileName: string,
  dataUrl: string,
  mimeType: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const base64Data = dataUrl.split(',')[1];
  const byteCharacters = atob(base64Data);
  const byteArrays = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArrays[i] = byteCharacters.charCodeAt(i);
  }
  const fileBlob = new Blob([byteArrays], { type: mimeType });

  const metadata: {
    name: string;
    mimeType: string;
    description: string;
    parents?: string[];
  } = {
    name: fileName,
    mimeType,
    description: 'Restored and exported image via ClearSlate Studio',
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', fileBlob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    }
  );

  if (res.status === 401 || res.status === 403) {
    clearCachedAccessToken();
    throw new Error('AUTH_REQUIRED');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to upload ${fileName} to Google Drive.`
    );
  }

  return await res.json();
}

export function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 600 });
    img.onerror = () => resolve({ width: 800, height: 600 });
    img.src = dataUrl;
  });
}
