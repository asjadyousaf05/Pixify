import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export type EncryptionAlgorithm = 'aes-256-gcm' | 'aes-256-cbc';

export interface EncryptionMetadata {
  id: string;
  algorithm: EncryptionAlgorithm;
  iterations: number;
  salt: string;
  iv: string;
  authTag: string | null;
  mimeType: string;
  originalName: string;
  encryptedFileName: string;
  downloadUrl: string;
  metadataUrl: string;
}

export interface EncryptResponse {
  id: string;
  algorithm: EncryptionAlgorithm;
  encryptedFileName: string;
  downloadUrl: string;
  metadataUrl: string;
  metadata: EncryptionMetadata;
}

export interface DecryptResponse {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

function parseFilename(contentDisposition?: string): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

export async function encryptImage(formData: FormData): Promise<EncryptResponse> {
  const { data } = await api.post<EncryptResponse>('/encrypt', formData);
  return data;
}

export async function decryptImage(formData: FormData): Promise<DecryptResponse> {
  const response = await api.post('/decrypt', formData, {
    responseType: 'blob',
  });

  const fileName = parseFilename(response.headers['content-disposition']) ?? 'decrypted-image.png';
  const mimeType = response.headers['content-type'] ?? 'application/octet-stream';

  return {
    blob: response.data as Blob,
    fileName,
    mimeType,
  };
}

export async function downloadFile(url: string, fileName: string): Promise<void> {
  const response = await api.get(url, {
    responseType: 'blob',
  });

  const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function readMetadataFile(file: File): Promise<Partial<EncryptionMetadata>> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<EncryptionMetadata>;
  return parsed;
}
