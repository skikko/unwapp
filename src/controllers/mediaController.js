const mediaService = require('../services/mediaService');

function upload(purpose) {
  return async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Seleziona un file' });
      const asset = await mediaService.createAsset(req.file, {
        uploadedBy: req.user?.username,
        purpose,
        req,
      });
      res.status(201).json({
        media: {
          id: asset.id,
          url: asset.url,
          name: asset.filename,
          type: asset.content_type,
          size: asset.byte_size,
        },
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  };
}

async function serve(req, res) {
  const asset = await mediaService.getAsset(req.params.token);
  if (!asset) return res.status(404).send('File non trovato');
  const disposition = asset.content_type.startsWith('image/')
    || asset.content_type.startsWith('audio/')
    || asset.content_type.startsWith('video/') ? 'inline' : 'attachment';
  const safeAscii = asset.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': asset.content_type,
    'Content-Length': String(asset.byte_size),
    'Content-Disposition': `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.end(asset.data);
}

module.exports = { upload, serve };
