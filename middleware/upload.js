import multer from 'multer';
import cloudinary from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';

// Configure Cloudinary (FREE: 25GB storage, 25GB bandwidth/month)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer storage with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'lab-reports', // Folder name in Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 1500, height: 1500, crop: 'limit' }], // Optional: resize
    public_id: (req, file) => {
      const userId = req.user?.userId || 'anonymous';
      return `${userId}-${Date.now()}`;
    },
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

// Upload to Cloudinary (automatic with multer-storage-cloudinary)
const uploadToCloudinary = async (file, userId) => {
  // File is already uploaded by multer middleware
  // Just return the result
  return {
    url: file.path, // Cloudinary URL
    key: file.filename, // Public ID
    public_id: file.filename,
  };
};

// Delete from Cloudinary
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === 'ok';
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw error;
  }
};

// Get Cloudinary URL (already public, no signed URL needed)
const getCloudinaryUrl = (publicId) => {
  return cloudinary.url(publicId, {
    secure: true, // Use HTTPS
  });
};

// Upload from buffer (for direct uploads without multer)
const uploadBufferToCloudinary = async (buffer, userId) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'lab-reports',
        public_id: `${userId}-${Date.now()}`,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({
          url: result.secure_url,
          key: result.public_id,
          public_id: result.public_id,
        });
      }
    );
    uploadStream.end(buffer);
  });
};

export { upload, uploadToCloudinary, getCloudinaryUrl, uploadBufferToCloudinary };