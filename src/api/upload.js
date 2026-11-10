import { applyUpload, initUpload, saveChunk, getUploadStatus, completeUpload } from '../services/uploadService.js';

export function registerUploadRoutes(app) {
  app.post('/api/uploads/apply', async (req) => applyUpload(req.body || {}));
  app.post('/api/uploads/init', async (req) => initUpload(req.body || {}));
  app.put('/api/uploads/:uploadId/chunks/:chunkIndex', async (req) =>
    saveChunk(req.params.uploadId, req.params.chunkIndex, req.body));
  app.get('/api/uploads/:uploadId', async (req) => getUploadStatus(req.params.uploadId));
  app.post('/api/uploads/:uploadId/complete', async (req) => completeUpload(req.params.uploadId));
}
