const DEPOSIT_PAID_STATUSES = ["deposit_paid", "deposit-paid", "paid", "completed"];

const remainingAmountOf = (booking = {}) => {
  const finalPrice = Number(booking.priceSnapshot?.finalPrice || booking.totalPrice || 0);
  return Math.max(0, Math.round(finalPrice - Number(booking.amountPaid || booking.depositAmount || 0)));
};

const isDepositPaid = (booking = {}) =>
  Boolean(booking.detailsUnlocked) || DEPOSIT_PAID_STATUSES.includes(String(booking.paymentStatus || "").toLowerCase());

const buildVerificationView = (booking) => {
  const data = typeof booking?.toObject === "function" ? booking.toObject() : { ...(booking || {}) };
  const paid = isDepositPaid(data);
  const guest = data.touristId && typeof data.touristId === "object" ? data.touristId : {};
  const details = data.bookingDetails && typeof data.bookingDetails === "object" ? data.bookingDetails : {};
  return {
    bookingId: data._id,
    _id: data._id,
    bookingCode: data.bookingCode || "",
    customerName: guest.name || details.fullName || "Customer",
    customerEmail: paid ? guest.email || details.email || "" : "",
    customerPhone: paid ? guest.phone || details.phone || "" : "",
    serviceName: details.requestedService || details.serviceName || data.destinationPlace || "",
    businessName: data.hotelId?.name || data.preferredHotelId?.name || "",
    checkIn: data.checkIn || details.bookingDate || details.checkIn || "",
    checkOut: data.checkOut || details.endBookingDate || details.endDate || details.checkOut || "",
    bookingDate: details.bookingDate || data.checkIn || data.createdAt,
    guests: Number(data.guests || details.numberOfPeople || details.guests || 1) || 1,
    quantity: Number(data.quantity || details.quantity || 1) || 1,
    amountPaid: Number(data.amountPaid || 0),
    depositAmount: Number(data.depositAmount || data.amountPaid || 0),
    remainingAmount: remainingAmountOf(data),
    totalPrice: Number(data.totalPrice || 0),
    paymentStatus: data.paymentStatus || "unpaid",
    bookingStatus: data.status,
    status: data.status,
    paid,
    detailsUnlocked: Boolean(data.detailsUnlocked),
    bookingCodeUsed: Boolean(data.bookingCodeUsed),
    verificationToken: paid ? data.verificationToken || "" : "",
    completedAt: data.completedAt || null,
    touristId: paid
      ? { _id: guest._id, name: guest.name || details.fullName, email: guest.email, phone: guest.phone }
      : { name: guest.name || details.fullName || "Customer" },
    hotelId: data.hotelId,
    preferredHotelId: data.preferredHotelId,
  };
};

module.exports = {
  DEPOSIT_PAID_STATUSES,
  remainingAmountOf,
  isDepositPaid,
  buildVerificationView,
};
