const Hotel = require("../models/Hotel");
const HotelService = require("../models/HotelService");
const Supplier = require("../models/Supplier");

const listPublicHotels = async (_req, res) => {
  try {
    const hotels = await Hotel.find({})
      .select(
        "name type location description basePrice amenities images services starRating hotelType bookingRules supplierId createdAt"
      )
      .sort({ createdAt: -1 });

    return res.json({ hotels, businesses: hotels });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace businesses.",
      error: error.message,
    });
  }
};

const listMarketplaceSuppliers = async (_req, res) => {
  try {
    const suppliers = await Supplier.find({ verificationStatus: "verified" })
      .select("name category supplierType description address pricing verificationStatus profile")
      .sort({ createdAt: -1 });

    return res.json({ suppliers });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch marketplace suppliers.",
      error: error.message,
    });
  }
};

const listHotelServices = async (req, res) => {
  try {
    const filter = req.params.hotelId
      ? { hotelId: req.params.hotelId, isActive: true }
      : { isActive: true };
    const services = await HotelService.find(filter)
      .select("hotelId category name description priceModel availabilitySchedule bookingIntegration")
      .sort({ category: 1, name: 1 });

    return res.json({ services });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch hotel services.",
      error: error.message,
    });
  }
};

module.exports = {
  listPublicHotels,
  listMarketplaceSuppliers,
  listHotelServices,
};
