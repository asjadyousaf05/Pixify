import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const storageRoot = path.join(__dirname, 'storage');
export const encryptedDir = path.join(storageRoot, 'encrypted');
export const metadataDir = path.join(storageRoot, 'metadata');
export const uploadsDir = path.join(storageRoot, 'uploads');

for (const dir of [storageRoot, encryptedDir, metadataDir, uploadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const records = new Map();

export function saveRecord(record) {
  records.set(record.id, record);
  return record;
}

export function getRecord(id) {
  return records.get(id) || null;
}

export function writeMetadataFile(id, metadata) {
  const filePath = path.join(metadataDir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  return filePath;
}

export function readMetadataFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}
