const { withPrimaryImage } = require("./serviceImages");
const { serializeAvailability } = require("../services/availabilityService");

const toPlain = (value) => {
  if (!value) return null;
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
};

const mapImage = (url, index, serviceName) => {
  const href = String(url || "").trim();
  if (!href) return null;
  return {
    url: href,
    alt: `${serviceName || "Service"} photo ${index + 1}`,
  };
};

const mapLinks = (latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      hasPin: false,
      latitude: null,
      longitude: null,
      googleMapsUrl: "",
      osmUrl: "",
    };
  }
  return {
    hasPin: true,
    latitude,
    longitude,
    googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
    osmUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
};

const serializeProvider = (user) => {
  const owner = toPlain(user);
  if (!owner?._id && !owner?.email) return null;
  return {
    id: owner._id || null,
    name: owner.name || "",
    email: owner.email || "",
    phone: owner.phone || "",
    sellerId: owner.sellerId || "",
    role: owner.role || "",
    emailVerified: Boolean(owner.emailVerified),
    mustSetPassword: Boolean(owner.mustSetPassword),
    createdAt: owner.createdAt || null,
    payoutDetails: owner.payoutDetails
      ? {
          method: owner.payoutDetails.method || "",
          providerName: owner.payoutDetails.providerName || "",
          accountName: owner.payoutDetails.accountName || "",
          msisdn: owner.payoutDetails.msisdn || "",
          verified: Boolean(owner.payoutDetails.verified),
        }
      : null,
  };
};

const serializeMapLocation = (business = {}) => {
  const source = business.serviceLocation || {};
  const contact = business.contactDetails || {};
  const latitude = Number.isFinite(Number(source.latitude))
    ? Number(source.latitude)
    : Number.isFinite(Number(contact.latitude))
      ? Number(contact.latitude)
      : null;
  const longitude = Number.isFinite(Number(source.longitude))
    ? Number(source.longitude)
    : Number.isFinite(Number(contact.longitude))
      ? Number(contact.longitude)
      : null;
  const formattedAddress =
    source.formattedAddress || source.fullAddress || contact.exactAddress || business.location || "";

  return {
    name: source.name || business.name || "",
    formattedAddress,
    fullAddress: formattedAddress,
    placeId: source.placeId || "",
    locationSource: source.locationSource || "",
    isExactLocationVerified: Boolean(source.isExactLocationVerified),
    country: source.country || "Rwanda",
    province: source.province || business.locationDetails?.province || "",
    district: source.district || business.locationDetails?.district || "",
    sector: source.sector || business.locationDetails?.sector || "",
    cell: source.cell || business.locationDetails?.cell || "",
    village: source.village || business.locationDetails?.village || "",
    ...mapLinks(latitude, longitude),
  };
};

const serializeImages = (business = {}) => {
  const { images } = withPrimaryImage(business);
  return images.map((url, index) => mapImage(url, index, business.name)).filter(Boolean);
};

const buildReview = (business = {}, provider, inventory = {}) => {
  const map = serializeMapLocation(business);
  const images = serializeImages(business);
  const missing = [];
  if (!provider?.name && !provider?.email) missing.push("provider");
  if (!images.length) missing.push("images");
  if (!map.hasPin) missing.push("mapLocation");
  if (!map.province || !map.district || !map.sector) missing.push("rwandaAddress");
  if (!String(business.description || "").trim()) missing.push("description");
  if (business.supportsOptions !== false && !(inventory.options || []).length) missing.push("options");

  return {
    approvalStatus: business.approvalStatus || "pending",
    canApprove: (business.approvalStatus || "pending") === "pending",
    canReject: ["pending", "approved"].includes(business.approvalStatus || "pending"),
    hasProvider: Boolean(provider?.id || provider?.email),
    hasImages: images.length > 0,
    hasExactCoordinates: map.hasPin,
    hasOptions: (inventory.options || []).length > 0,
    optionCount: (inventory.options || []).length,
    roomCount: (inventory.rooms || []).length,
    missing,
  };
};

const serializeAdminOption = (option = {}, availability = null) => {
  const data = toPlain(option) || {};
  return {
    _id: data._id,
    id: data._id,
    serviceId: data.serviceId,
    name: data.name || "",
    price: Number(data.price || 0),
    currency: data.currency || "RWF",
    priceType: data.priceType || "",
    calculationField: data.calculationField || "",
    durationUnit: data.durationUnit || "",
    maximumDuration: data.maximumDuration ?? null,
    capacity: Number(data.capacity || data.attributes?.quantity || 1),
    availableFrom: data.availableFrom || "",
    availableTo: data.availableTo || "",
    availableDays: Array.isArray(data.availableDays) ? data.availableDays : [],
    availableStartTime: data.availableStartTime || "",
    availableEndTime: data.availableEndTime || "",
    requiresTime: Boolean(data.requiresTime),
    details: data.details || "",
    attributes: data.attributes && typeof data.attributes === "object" ? data.attributes : {},
    sortOrder: Number(data.sortOrder || 0),
    isActive: data.isActive !== false,
    availability: availability ? serializeAvailability(availability) : null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
};

const serializeAdminRoom = (room = {}) => {
  const data = toPlain(room) || {};
  return {
    _id: data._id,
    id: data._id,
    roomNumber: data.roomNumber || "",
    type: data.type || data.roomType || "",
    roomType: data.roomType || data.type || "",
    price: Number(data.price || data.pricePerNight || 0),
    pricePerNight: Number(data.pricePerNight || data.price || 0),
    capacity: data.capacity || {},
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    status: data.status || "",
    availabilityCalendar: Array.isArray(data.availabilityCalendar) ? data.availabilityCalendar : [],
  };
};

const serializeNestedService = (item = {}) => {
  const data = toPlain(item) || {};
  return {
    _id: data._id,
    id: data._id,
    name: data.name || "",
    category: data.category || "",
    description: data.description || "",
    price: Number(data.price || 0),
    status: data.status || "",
  };
};

const optionIdKey = (value) => (value ? String(value) : "");

const attachInventory = ({
  options = [],
  availabilities = [],
  rooms = [],
  nestedServices = [],
} = {}) => {
  const availabilityByOption = new Map();
  let serviceAvailability = null;
  (availabilities || []).forEach((row) => {
    const serialized = serializeAvailability(row);
    if (row.optionId) availabilityByOption.set(optionIdKey(row.optionId), serialized);
    else if (row.scope === "service" || !row.optionId) serviceAvailability = serialized;
  });
  const serializedOptions = (options || []).map((option) =>
    serializeAdminOption(option, availabilityByOption.get(optionIdKey(option._id || option.id)))
  );
  return {
    options: serializedOptions,
    units: serializedOptions,
    rooms: (rooms || []).map(serializeAdminRoom),
    nestedServices: (nestedServices || []).map(serializeNestedService),
    availabilities: (availabilities || []).map(serializeAvailability),
    availability: serviceAvailability,
  };
};

const serializeAdminServiceListItem = (business, provider) => {
  const data = withPrimaryImage(toPlain(business) || {});
  const owner = serializeProvider(provider || data.ownerUserId);
  const map = serializeMapLocation(data);
  const images = serializeImages(data);

  return {
    ...data,
    id: data._id,
    businessId: data._id,
    title: data.name,
    category: data.type,
    availableQuantity: data.quantityRemaining ?? data.availableQuantity ?? 0,
    verificationStatus: data.approvalStatus,
    provider: owner,
    providerName: owner?.name || "",
    providerEmail: owner?.email || "",
    sellerId: owner?.sellerId || "",
    images: images.map((image) => image.url),
    primaryImage: data.primaryImage || "",
    imageCount: images.length,
    locationSummary: [map.district, map.sector, map.province].filter(Boolean).join(", "),
    hasExactLocation: map.hasPin,
    ownerUserId: data.ownerUserId?._id || data.ownerUserId || owner?.id || null,
  };
};

const serializeAdminServiceDetail = (
  business,
  { provider, options = [], availabilities = [], rooms = [], nestedServices = [] } = {}
) => {
  const data = withPrimaryImage(toPlain(business) || {});
  const owner = serializeProvider(provider || data.ownerUserId);
  const map = serializeMapLocation(data);
  const images = serializeImages(data);
  const inventory = attachInventory({ options, availabilities, rooms, nestedServices });
  const review = buildReview(data, owner, inventory);

  return {
    id: data._id,
    businessId: data._id,
    title: data.name,
    name: data.name,
    category: data.categorySlug || data.type || "",
    type: data.type,
    domain: data.domain || data.schemaSnapshot?.domain || "",
    subtype: data.subtype || data.schemaSnapshot?.subtype || data.categorySlug || data.type || "",
    description: data.description || "",
    approvalStatus: data.approvalStatus,
    verificationStatus: data.approvalStatus,
    status: data.status,
    bookingMode: data.bookingMode || "manual",
    inventoryStatus: data.inventoryStatus,
    availableQuantity: data.quantityRemaining ?? data.availableQuantity ?? 0,
    quantityRemaining: data.quantityRemaining ?? data.availableQuantity ?? 0,
    basePrice: Number(data.basePrice || 0),
    commissionPercentage: data.commissionPercentage,
    cancelWindowHours: data.cancelWindowHours,
    cancelPenaltyPercent: data.cancelPenaltyPercent,
    priceText: data.priceText || "",
    amenities: data.amenities || [],
    images,
    imageUrls: images.map((image) => image.url),
    primaryImage: data.primaryImage || "",
    categoryId: data.categoryId || null,
    categorySlug: data.categorySlug || data.type || "",
    listingAttributes: data.listingAttributes || {},
    paymentPolicy: data.paymentPolicy || null,
    cancellationPolicy: data.cancellationPolicy || null,
    supportsOptions: data.supportsOptions !== false,
    schemaSnapshot: data.schemaSnapshot || null,
    catalogLocation: data.catalogLocation || null,
    agreementTerms: data.agreementTerms || null,
    platformCommissionPercent: data.commissionPercentage,
    location: data.location,
    locationDetails: data.locationDetails || {},
    serviceLocation: {
      ...(data.serviceLocation || {}),
      ...map,
    },
    map,
    contactDetails: data.contactDetails || {},
    contactInfo: data.contactInfo || "",
    promotion: data.promotion || { enabled: false },
    availabilityTable: data.availabilityTable || { columns: [], rows: [] },
    bookingForm: data.bookingForm || {},
    bookingRules: data.bookingRules || {},
    checkInWindow: data.checkInWindow || {},
    payoutDetails: data.payoutDetails || {},
    rebookSettings: data.rebookSettings || {},
    provider: owner,
    providerName: owner?.name || "",
    providerEmail: owner?.email || "",
    sellerId: owner?.sellerId || "",
    inventoryLabel:
      data.inventoryLabel ||
      (data.domain === "accommodation" || data.schemaSnapshot?.domain === "accommodation" ? "rooms" : "options"),
    ...inventory,
    serviceOptions: inventory.options,
    review,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const resolveApprovalStatus = ({ body = {}, path = "", query = {} } = {}) => {
  const raw = String(
    body.status || body.verificationStatus || body.approvalStatus || body.action || query.status || ""
  )
    .trim()
    .toLowerCase();
  if (raw === "verified" || raw === "approved" || raw === "approve") return "approved";
  if (raw === "rejected" || raw === "reject") return "rejected";
  if (/\/approve$/i.test(path)) return "approved";
  if (/\/reject$/i.test(path)) return "rejected";
  return raw === "pending" ? "pending" : "";
};

module.exports = {
  serializeProvider,
  serializeMapLocation,
  serializeAdminServiceListItem,
  serializeAdminServiceDetail,
  serializeAdminOption,
  attachInventory,
  resolveApprovalStatus,
};
