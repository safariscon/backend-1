const MAX_SERVICE_IMAGES = 3;

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const parseImageList = (images) =>
  (Array.isArray(images) ? images : images ? [images] : [])
    .map((url) => String(url || "").trim())
    .filter(isHttpUrl);

const resolvePrimaryImage = (source = {}) => {
  const images = parseImageList(source.images);
  const primary = String(source.primaryImage || "").trim();
  return isHttpUrl(primary) ? primary : images[0] || "";
};

const withPrimaryImage = (source = {}) => {
  const images = parseImageList(source.images);
  const primaryImage = resolvePrimaryImage({ ...source, images });
  const rest = images.filter((url) => url !== primaryImage);
  const ordered = primaryImage ? [primaryImage, ...rest].slice(0, MAX_SERVICE_IMAGES) : images.slice(0, MAX_SERVICE_IMAGES);
  return {
    ...source,
    images: ordered,
    primaryImage,
  };
};

const normalizeServiceImages = ({ images, primaryImage, requireCover = true } = {}) => {
  const parsed = parseImageList(images);
  const cover = resolvePrimaryImage({ images: parsed, primaryImage });
  if (requireCover && !cover) {
    return { error: "A cover image is required. Provide primaryImage or images[0]." };
  }

  const rest = parsed.filter((url) => url !== cover);
  const ordered = cover ? [cover, ...rest].slice(0, MAX_SERVICE_IMAGES) : parsed.slice(0, MAX_SERVICE_IMAGES);
  return { images: ordered, primaryImage: cover };
};

module.exports = {
  MAX_SERVICE_IMAGES,
  parseImageList,
  resolvePrimaryImage,
  withPrimaryImage,
  normalizeServiceImages,
};
