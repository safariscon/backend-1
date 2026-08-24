const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const Booking = require("../models/Booking");
const mongoose = require("mongoose");

const VERIFIED_STATUSES = ["confirmed", "waiting-for-payment", "deposit-paid", "provider-details-unlocked", "completed"];

const serializeReview = (review) => {
  const user = review.userId && typeof review.userId === "object" ? review.userId : {};
  return {
    id: review._id,
    serviceId: review.serviceId,
    rating: Number(review.rating || 0),
    comment: review.comment || "",
    verifiedStay: Boolean(review.verifiedStay),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    author: {
      id: user._id || review.userId,
      name: user.name || "Guest",
      avatarUrl: user.avatarUrl || "",
    },
  };
};

const hasVerifiedStay = async (userId, serviceId) => {
  const booking = await Booking.findOne({
    touristId: userId,
    hotelId: serviceId,
    status: { $in: VERIFIED_STATUSES },
  })
    .select("_id")
    .lean();
  return Boolean(booking);
};

const asObjectId = (value) => {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
};

const reviewStatsForService = async (serviceId) => {
  const id = asObjectId(serviceId);
  if (!id) return { ratingAverage: 0, reviewCount: 0 };
  const [stats] = await Review.aggregate([
    { $match: { serviceId: id } },
    { $group: { _id: "$serviceId", average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return {
    ratingAverage: stats ? Math.round(Number(stats.average) * 10) / 10 : 0,
    reviewCount: stats ? Number(stats.count) : 0,
  };
};

const listReviews = async (req, res) => {
  try {
    const serviceId = req.params.hotelId || req.params.serviceId;
    const hotel = await Hotel.findOne({ _id: serviceId, approvalStatus: "approved" }).select("_id").lean();
    if (!hotel) return res.status(404).json({ message: "Service not found." });

    const reviews = await Review.find({ serviceId: hotel._id })
      .populate("userId", "name avatarUrl")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const stats = await reviewStatsForService(hotel._id);
    return res.json({
      reviews: reviews.map(serializeReview),
      ...stats,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load reviews.", error: error.message });
  }
};

const upsertReview = async (req, res) => {
  try {
    const serviceId = req.params.hotelId || req.params.serviceId;
    const hotel = await Hotel.findOne({ _id: serviceId, approvalStatus: "approved" }).select("_id").lean();
    if (!hotel) return res.status(404).json({ message: "Service not found." });

    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Choose a rating from 1 to 5." });
    }
    if (comment.length < 8) {
      return res.status(400).json({ message: "Write a short review (at least 8 characters)." });
    }

    const verifiedStay = await hasVerifiedStay(req.user._id, hotel._id);
    const saved = await Review.findOneAndUpdate(
      { serviceId: hotel._id, userId: req.user._id },
      {
        $set: {
          rating: Math.round(rating),
          comment: comment.slice(0, 2000),
          verifiedStay,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    const review = await Review.findById(saved._id).populate("userId", "name avatarUrl").lean();

    const stats = await reviewStatsForService(hotel._id);
    return res.status(201).json({
      message: "Review saved.",
      review: serializeReview(review),
      ...stats,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save review.", error: error.message });
  }
};

module.exports = {
  listReviews,
  upsertReview,
  reviewStatsForService,
  serializeReview,
};
