import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decryptBuffer, encryptBuffer } from './crypto.js';
import { encryptedDir, getRecord, saveRecord, writeMetadataFile, readMetadataFile } from './store.js';
const app = express();
const port = process.env.PORT || 4000;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/encrypt', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const password = String(req.body.password || '');
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const algorithm = req.body.algorithm === 'aes-256-cbc' ? 'aes-256-cbc' : 'aes-256-gcm';
    const imageBuffer = req.file.buffer;
    const result = encryptBuffer({
      buffer: imageBuffer,
      password,
      algorithm,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });

    const id = crypto.randomUUID();
    const encryptedFileName = `${id}.enc`;
    const encryptedPath = path.join(encryptedDir, encryptedFileName);
    fs.writeFileSync(encryptedPath, result.encryptedData);

    const record = saveRecord({
      id,
      encryptedPath,
      encryptedFileName,
      metadataPath: null,
      metadata: result.metadata,
      createdAt: new Date().toISOString(),
    });

    const metadata = {
      id,
      ...result.metadata,
      encryptedFileName,
      downloadUrl: `/download/${id}`,
      metadataUrl: `/metadata/${id}`,
    };

    const metadataPath = writeMetadataFile(id, metadata);
    record.metadataPath = metadataPath;
    record.metadata = metadata;
    saveRecord(record);

    return res.json({
      id,
      algorithm,
      encryptedFileName,
      downloadUrl: `/download/${id}`,
      metadataUrl: `/metadata/${id}`,
      metadata,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Encryption failed' });
  }
});

app.get('/download/:id', (req, res) => {
  const record = getRecord(req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'Encrypted file not found' });
  }

  return res.download(record.encryptedPath, record.encryptedFileName);
});

app.get('/metadata/:id', (req, res) => {
  const record = getRecord(req.params.id);
  if (!record || !record.metadataPath || !fs.existsSync(record.metadataPath)) {
    return res.status(404).json({ error: 'Metadata not found' });
  }

  const metadata = readMetadataFile(record.metadataPath);
  return res.json(metadata);
});

app.post('/decrypt', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Encrypted file is required' });
    }

    const password = String(req.body.password || '');
    const salt = String(req.body.salt || '');
    const iv = String(req.body.iv || '');
    const authTag = String(req.body.authTag || '');
    const algorithm = req.body.algorithm === 'aes-256-cbc' ? 'aes-256-cbc' : 'aes-256-gcm';

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    let parsedMetadata = null;
    if (req.body.metadata) {
      try {
        parsedMetadata = JSON.parse(req.body.metadata);
      } catch {
        return res.status(400).json({ error: 'Invalid metadata JSON' });
      }
    }

    const resolvedSalt = parsedMetadata?.salt || salt;
    const resolvedIv = parsedMetadata?.iv || iv;
    const resolvedAuthTag = parsedMetadata?.authTag || authTag;
    const resolvedAlgorithm = parsedMetadata?.algorithm || algorithm;
    const mimeType = parsedMetadata?.mimeType || 'image/png';
    const originalName = parsedMetadata?.originalName || 'decrypted-image.png';

    if (!resolvedSalt || !resolvedIv) {
      return res.status(400).json({ error: 'salt and iv are required' });
    }

    const decryptedBuffer = decryptBuffer({
      encryptedData: req.file.buffer,
      password,
      saltHex: resolvedSalt,
      ivHex: resolvedIv,
      authTagHex: resolvedAuthTag,
      algorithm: resolvedAlgorithm,
    });

    const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'bin';
    const downloadName = originalName.toLowerCase().endsWith(`.${extension}`) ? originalName : `decrypted.${extension}`;
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.type(mimeType);
    return res.send(decryptedBuffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Decryption failed' });
  }
});

app.listen(port, () => {
  console.log(`AES encryption server running on http://localhost:${port}`);
});
