const express = require("express");
const {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
} = require("../controllers/serviceController");
const { protect, hotelOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", listServices);
router.get("/:serviceId", getService);
router.post("/create", protect, hotelOnly, createService);
router.patch("/:serviceId", protect, hotelOnly, updateService);
router.delete("/:serviceId", protect, hotelOnly, deleteService);

module.exports = router;
