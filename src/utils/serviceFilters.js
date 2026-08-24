const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const regexContains = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), "i");
};

const andFilters = (parts = []) => {
  const valid = parts.filter(Boolean);
  if (!valid.length) return {};
  if (valid.length === 1) return valid[0];
  return { $and: valid };
};

const locationClause = (location) => {
  const loc = regexContains(location);
  if (!loc) return null;
  return {
    $or: [
      { location: loc },
      { "locationDetails.province": loc },
      { "locationDetails.district": loc },
      { "locationDetails.sector": loc },
      { "locationDetails.cell": loc },
      { "serviceLocation.province": loc },
      { "serviceLocation.district": loc },
      { "serviceLocation.sector": loc },
    ],
  };
};

const publicSearchClause = (search) => {
  const term = regexContains(search);
  if (!term) return null;
  return {
    $or: [
      { type: term },
      { location: term },
      { "locationDetails.province": term },
      { "locationDetails.district": term },
      { "locationDetails.sector": term },
      { "serviceLocation.province": term },
      { "serviceLocation.district": term },
      { "serviceLocation.sector": term },
    ],
  };
};

const approvedCatalogClause = () => ({
  $and: [
    { approvalStatus: { $ne: "rejected" } },
    {
      $or: [
        { approvalStatus: "approved" },
        { approvalStatus: { $exists: false } },
      ],
    },
  ],
});

const buildPublicCatalogFilter = (query = {}) => {
  const category = String(query.category || query.type || "").trim();
  const location = String(query.location || query.district || query.province || "").trim();
  const search = String(query.search || query.q || "").trim();
  return andFilters([
    approvedCatalogClause(),
    category ? { type: regexContains(category) } : null,
    locationClause(location),
    publicSearchClause(search),
  ]);
};

const publicCatalogCacheKey = (query = {}, page, limit) => {
  const category = String(query.category || query.type || "").trim().toLowerCase();
  const location = String(query.location || query.district || query.province || "").trim().toLowerCase();
  const search = String(query.search || query.q || "").trim().toLowerCase();
  const checkIn = String(query.checkIn || query.startDate || "").trim();
  const checkOut = String(query.checkOut || query.endDate || "").trim();
  return `public:hotels:${page}:${limit}:${category}:${location}:${search}:${checkIn}:${checkOut}`;
};

const buildAdminServiceFilter = (query = {}, ownerUserId) => {
  const category = String(query.category || query.type || "").trim();
  const location = String(query.location || query.district || query.province || "").trim();
  const search = String(query.search || query.q || "").trim();
  const approvalStatus = String(query.approvalStatus || "").trim().toLowerCase();
  const parts = [];
  if (ownerUserId) parts.push({ ownerUserId });
  if (category) parts.push({ type: regexContains(category) });
  const loc = locationClause(location);
  if (loc) parts.push(loc);
  if (search) {
    const term = regexContains(search);
    parts.push({
      $or: [
        { name: term },
        { type: term },
        { location: term },
        { ownerEmail: term },
        { description: term },
      ],
    });
  }
  if (["draft", "pending", "approved", "rejected"].includes(approvalStatus)) {
    parts.push({ approvalStatus });
  }
  return andFilters(parts);
};

module.exports = {
  regexContains,
  buildPublicCatalogFilter,
  publicCatalogCacheKey,
  buildAdminServiceFilter,
};
