import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now } from '../core/db.js';
import { getConfig, ROOT } from '../core/config.js';
import { pressure } from '../core/pressure.js';
import { createTask, queuePosition } from './taskService.js';

const uploadsDir = path.join(ROOT, 'storage', 'uploads');
const filesDir = path.join(ROOT, 'storage', 'files');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(filesDir, { recursive: true });

const ID = () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function sanitizeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.-]+/g, '_').slice(-80);
  return base || 'upload.bin';
}

function allowedExt(name) {
  const ext = (path.extname(name).slice(1) || '').toLowerCase();
  const list = getConfig().allowedTypes || [];
  return list.includes(ext) ? ext : null;
}

export function getUploadRow(id) {
  return db.prepare('SELECT * FROM uploads WHERE id=?').get(id);
}

const chunksDir = (id) => path.join(uploadsDir, id);

function countChunks(id) {
  try {
    return fs.readdirSync(chunksDir(id)).filter((f) => f.endsWith('.part')).length;
  } catch {
    return 0;
  }
}

function syncPressure() {
  const c = db.prepare("SELECT COUNT(*) AS c FROM uploads WHERE status IN ('INIT','UPLOADING')").get().c;
  pressure.setSnapshot({ activeUploads: c });
}

/** 申请上传：allowed 直接开始；queued 返回排队号；rejected 压力/规则拒绝（方案 §7） */
export function applyUpload({ fileName, fileSize, fileType, bizType = 'demo-import', ticketId } = {}) {
  const c = getConfig();
  fileSize = Number(fileSize);
  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0) throw bad('参数不完整：需要 fileName 与 fileSize');
  if (fileSize > c.maxFileSize) return { status: 'rejected', reason: `文件超过大小限制(${Math.round(c.maxFileSize / 1024 / 1024)}MB)` };
  if (!allowedExt(fileName)) return { status: 'rejected', reason: '文件类型不在白名单内' };
  if (!pressure.acceptingNewTasks) return { status: 'rejected', reason: '服务器压力过高或磁盘不足，请稍后再试' };

  let id = null;
  let row = null;
  if (ticketId && /^[A-Za-z0-9_-]+$/.test(ticketId)) {
    row = getUploadRow(ticketId);
    if (row && row.status === 'QUEUED') id = ticketId;
  }

  if (!pressure.slotsAvailable) {
    if (!id) {
      id = `up_${ID()}`;
      db.prepare(`INSERT INTO uploads (id,file_name,file_size,chunk_size,chunk_count,uploaded_chunk_count,status,biz_type,created_at,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, sanitizeName(fileName), fileSize, c.chunkSize, Math.ceil(fileSize / c.chunkSize), 0, 'QUEUED', bizType, now(), now());
    }
    const pos = db.prepare("SELECT COUNT(*) AS c FROM uploads WHERE status='QUEUED'").get().c;
    return { status: 'queued', ticketId: id, queuePosition: pos };
  }

  if (!id) id = `up_${ID()}`;
  if (!row) {
    db.prepare(`INSERT INTO uploads (id,file_name,file_size,chunk_size,chunk_count,uploaded_chunk_count,status,biz_type,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, sanitizeName(fileName), fileSize, c.chunkSize, Math.ceil(fileSize / c.chunkSize), 0, 'INIT', bizType, now(), now());
  } else {
    db.prepare("UPDATE uploads SET status='INIT', updated_at=? WHERE id=?").run(now(), id);
  }
  fs.mkdirSync(chunksDir(id), { recursive: true });
  syncPressure();
  return { status: 'allowed', uploadId: id, chunkSize: c.chunkSize, chunkCount: Math.ceil(fileSize / c.chunkSize) };
}

/** 初始化/恢复上传：同文件同大小可续传 */
export function initUpload({ fileName, fileSize } = {}) {
  const c = getConfig();
  fileSize = Number(fileSize);
  if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0) throw bad('参数不完整：需要 fileName 与 fileSize');
  const row = db.prepare(`SELECT * FROM uploads WHERE file_name=? AND file_size=? AND status IN ('INIT','UPLOADING')
                          ORDER BY updated_at DESC LIMIT 1`).get(sanitizeName(fileName), fileSize);
  const id = row ? row.id : `up_${ID()}`;
  if (!row) {
    db.prepare(`INSERT INTO uploads (id,file_name,file_size,chunk_size,chunk_count,uploaded_chunk_count,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, sanitizeName(fileName), fileSize, c.chunkSize, Math.ceil(fileSize / c.chunkSize), 0, 'INIT', now(), now());
  }
  fs.mkdirSync(chunksDir(id), { recursive: true });
  syncPressure();
  return { uploadId: id, chunkSize: c.chunkSize, chunkCount: Math.ceil(fileSize / c.chunkSize) };
}

export function saveChunk(uploadId, chunkIndex, buffer) {
  if (!/^[A-Za-z0-9_-]+$/.test(uploadId || '')) throw bad('非法上传ID');
  const row = getUploadRow(uploadId);
  if (!row) throw bad('上传记录不存在', 404);
  if (row.status === 'QUEUED') throw bad('上传仍在排队中，请重新申请上传槽位', 409);
  if (row.status === 'COMPLETED') throw bad('上传已完成，请勿重复提交', 409);
  const idx = Number(chunkIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= row.chunk_count) throw bad('分片序号越界');
  const c = getConfig();
  if (!buffer || !buffer.length || buffer.length > c.chunkSize + 1024) throw bad('分片大小不合法');

  fs.mkdirSync(chunksDir(uploadId), { recursive: true });
  const tmp = path.join(chunksDir(uploadId), `${idx}.part.tmp`);
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, path.join(chunksDir(uploadId), `${idx}.part`));

  const uploaded = countChunks(uploadId);
  db.prepare("UPDATE uploads SET status='UPLOADING', uploaded_chunk_count=?, updated_at=? WHERE id=?")
    .run(uploaded, now(), uploadId);
  syncPressure();
  return { uploadId, chunkIndex: idx, received: true, uploadedChunkCount: uploaded, progress: Math.round((uploaded / row.chunk_count) * 100) };
}

export function getUploadStatus(uploadId) {
  if (!/^[A-Za-z0-9_-]+$/.test(uploadId || '')) throw bad('非法上传ID');
  const row = getUploadRow(uploadId);
  if (!row) throw bad('上传记录不存在', 404);
  const uploaded = countChunks(uploadId);
  const status = row.status === 'COMPLETED' ? 'completed' : row.status === 'QUEUED' ? 'queued' : 'uploading';
  return {
    uploadId,
    status,
    chunkCount: row.chunk_count,
    uploadedChunkCount: uploaded,
    progress: Math.min(100, Math.round((uploaded / Math.max(1, row.chunk_count)) * 100)),
  };
}

/** 完成上传：校验完整性 → 合并 → 创建任务（方案 §8.4） */
export function completeUpload(uploadId) {
  if (!/^[A-Za-z0-9_-]+$/.test(uploadId || '')) throw bad('非法上传ID');
  const row = getUploadRow(uploadId);
  if (!row) throw bad('上传记录不存在', 404);
  if (row.status === 'COMPLETED') {
    const task = db.prepare('SELECT * FROM tasks WHERE upload_id=? ORDER BY seq DESC LIMIT 1').get(uploadId);
    if (task) return { taskId: task.id, status: 'queued', queuePosition: 0, dedup: true };
    throw bad('上传已完成但任务缺失', 409);
  }

  const dir = chunksDir(uploadId);
  const have = countChunks(uploadId);
  if (have !== row.chunk_count) throw bad(`分片不完整(${have}/${row.chunk_count})`, 409);

  let total = 0;
  for (let i = 0; i < row.chunk_count; i++) total += fs.statSync(path.join(dir, `${i}.part`)).size;
  if (total !== row.file_size) throw bad('合并后大小与申报不一致', 409);

  const finalPath = path.join(filesDir, `${uploadId}__${row.file_name}`);
  fs.writeFileSync(finalPath, Buffer.alloc(0));
  for (let i = 0; i < row.chunk_count; i++) fs.appendFileSync(finalPath, fs.readFileSync(path.join(dir, `${i}.part`)));
  fs.rmSync(dir, { recursive: true, force: true });

  const rel = path.relative(ROOT, finalPath);
  db.prepare("UPDATE uploads SET status='COMPLETED', uploaded_chunk_count=?, storage_path=?, updated_at=? WHERE id=?")
    .run(row.chunk_count, rel, now(), uploadId);
  syncPressure();

  const task = createTask({ uploadId, type: row.biz_type || 'demo-import' });
  return { taskId: task.id, status: 'queued', queuePosition: queuePosition(task.id) };
}
