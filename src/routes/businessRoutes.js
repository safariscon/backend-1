const express = require("express");
const Business = require("../models/Business");
const { registerBusinessOwner } = require("../controllers/authController");
const { decorateBusiness } = require("../utils/marketplaceTypes");

const router = express.Router();

router.post("/register", registerBusinessOwner);

router.get("/", async (_req, res) => {
  try {
    const businesses = await Business.find({})
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ businesses: businesses.map(decorateBusiness) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch businesses.", error: error.message });
  }
});

router.get("/:businessId", async (req, res) => {
  try {
    const business = await Business.findById(req.params.businessId).lean();
    if (!business) return res.status(404).json({ message: "Business not found." });
    return res.json({ business: decorateBusiness(business) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch business.", error: error.message });
  }
});

module.exports = router;
