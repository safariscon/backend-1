const { Readable } = require("stream");
const configureCloudinary = require("../config/cloudinary");

const uploadBufferToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    const cloudinary = configureCloudinary();
    const folder = process.env.CLOUDINARY_FOLDER || "safariservconn";

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    Readable.from(file.buffer).pipe(uploadStream); 
  });

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Image file is required." });
    }

    const result = await uploadBufferToCloudinary(req.file);

    return res.status(201).json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Image upload failed.",
      error: error.message,
    });
  }
};

const uploadImages = async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files.slice(0, 3) : [];
    if (files.length === 0) {
      return res.status(400).json({ message: "At least one image file is required." });
    }

    const results = await Promise.all(files.map((file) => uploadBufferToCloudinary(file)));

    return res.status(201).json({
      urls: results.map((result) => result.secure_url),
      images: results.map((result) => ({
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Image upload failed.",
      error: error.message,
    });
  }
};

module.exports = {
  uploadBufferToCloudinary,
  uploadImage,
  uploadImages,
};
