const { Readable } = require("stream");
const configureCloudinary = require("../config/cloudinary");

const safeFilePart = (value) => String(value || "booking")
  .replace(/[^a-zA-Z0-9_-]/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 100);

const uploadBookingPdf = (pdfBuffer, receiptNumber, cloudinaryClient = null) => new Promise((resolve, reject) => {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    reject(new Error("A valid booking PDF buffer is required."));
    return;
  }
  const cloudinary = cloudinaryClient || configureCloudinary();
  const rootFolder = String(process.env.CLOUDINARY_FOLDER || "safariservconn").replace(/^\/+|\/+$/g, "");
  const publicId = rootFolder + "/booking-pdfs/" + safeFilePart(receiptNumber);
  const uploadStream = cloudinary.uploader.upload_stream(
    {
      resource_type: "raw",
      type: "authenticated",
      public_id: publicId,
      overwrite: true,
      invalidate: true,
      use_filename: false,
    },
    (error, result) => {
      if (error) return reject(error);
      return resolve({
        url: result.secure_url,
        publicId: result.public_id,
        bytes: Number(result.bytes || pdfBuffer.length),
        resourceType: result.resource_type || "raw",
        deliveryType: result.type || "authenticated",
        format: "pdf",
      });
    }
  );
  Readable.from(pdfBuffer).pipe(uploadStream);
});

const storeBookingPdf = async ({ booking, business, transaction, pdfBuffer, createPdfReceipt, verifyUrl }) => {
  const pdf = pdfBuffer || await createPdfReceipt({ booking, business, transaction, verifyUrl });
  const stored = await uploadBookingPdf(pdf, booking.receipt?.receiptNumber || booking.bookingCode || booking._id);
  booking.receipt = {
    ...(booking.receipt?.toObject ? booking.receipt.toObject() : booking.receipt || {}),
    contentType: "application/pdf",
    cloudinaryUrl: stored.url,
    cloudinaryPublicId: stored.publicId,
    cloudinaryResourceType: stored.resourceType,
    cloudinaryDeliveryType: stored.deliveryType,
    cloudinaryFormat: stored.format,
    bytes: stored.bytes,
    storageStatus: "stored",
    storedAt: new Date(),
  };
  await booking.save();
  return { pdf, stored };
};

const getBookingPdfDownloadUrl = (receipt) => {
  if (!receipt?.cloudinaryPublicId) return receipt?.cloudinaryUrl || "";
  const cloudinary = configureCloudinary();
  return cloudinary.utils.private_download_url(
    receipt.cloudinaryPublicId,
    receipt.cloudinaryFormat || "pdf",
    {
      resource_type: receipt.cloudinaryResourceType || "raw",
      type: receipt.cloudinaryDeliveryType || "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      attachment: true,
    }
  );
};

module.exports = { uploadBookingPdf, storeBookingPdf, getBookingPdfDownloadUrl };
