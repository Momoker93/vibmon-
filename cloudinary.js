const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'ddfbuh46l',
  api_key:    process.env.CLOUDINARY_API_KEY    || '892334931819298',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'OSZGfOg-Y3HbX51W3xQAOTWVbSM',
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'vibmon',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

async function deleteImage(publicId) {
  try { await cloudinary.uploader.destroy(publicId); } catch(e) { console.error('Cloudinary delete error:', e.message); }
}

module.exports = { cloudinary, upload, deleteImage };
