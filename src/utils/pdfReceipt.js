const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const BLUE = "#0754D7";
const INK = "#102044";
const MUTED = "#60708F";
const LINE = "#DCE5F5";
const PALE = "#F4F7FC";

const money = (value) => `${Number(value || 0).toLocaleString("en-RW")} RWF`;
const clean = (value, fallback = "-") => String(value || fallback).replace(/\s+/g, " ").trim();
const formatDate = (value, includeTime = false) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return includeTime ? date.toLocaleString("en-RW") : date.toLocaleDateString("en-RW");
};

const drawLabelValue = (doc, label, value, x, y, width) => {
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x, y, { width });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(clean(value), x, y + 13, { width, height: 28, ellipsis: true });
};

const drawSection = (doc, title, rows, y) => {
  doc.roundedRect(42, y, 528, 84, 9).fillAndStroke(PALE, LINE);
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(10).text(title.toUpperCase(), 56, y + 11);
  rows.slice(0, 3).forEach(([label, value], index) => {
    drawLabelValue(doc, label, value, 56 + index * 171, y + 32, 154);
  });
};

const createPdfReceipt = async ({ booking, business, transaction, verifyUrl }) => {
  const qrDataUrl = await QRCode.toDataURL(verifyUrl || booking.verificationToken || booking.bookingCode, {
    margin: 1,
    width: 280,
    errorCorrectionLevel: "M",
    color: { dark: INK, light: "#FFFFFF" },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const amountPaid = Number(booking.amountPaid || 0);
  const total = Number(booking.totalPrice || amountPaid || 0);
  const remaining = Math.max(0, total - amountPaid);
  const serviceName = booking.bookingDetails?.serviceName || booking.destinationPlace || "Booked service";
  const bookingDate = booking.checkIn || booking.reservationDate || booking.createdAt;
  const bookingTime = booking.reservationTime || booking.bookingDetails?.reservationTime || "As arranged";
  const contact = business?.contactDetails?.phone || business?.contactDetails?.email || business?.contactInfo || business?.sellerContactEmail || business?.ownerEmail || "-";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Booking ${booking.bookingCode || booking._id}` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, 595.28, 122).fill(BLUE);
    doc.roundedRect(42, 35, 42, 42, 11).fill("#FFFFFF");
    doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(23).text("S", 55, 45);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(20).text("safariscon", 98, 39);
    doc.font("Helvetica").fontSize(9).fillColor("#DCE9FF").text("SECURE MARKETPLACE BOOKING", 98, 65);
    doc.font("Helvetica-Bold").fontSize(19).fillColor("#FFFFFF").text("BOOKING CONFIRMATION", 345, 42, { width: 208, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#DCE9FF").text(clean(booking.receipt?.receiptNumber || booking.bookingCode), 345, 69, { width: 208, align: "right" });

    drawSection(doc, "Booking", [
      ["Booking ID", booking.bookingCode || booking._id],
      ["Status", booking.status],
      ["Payment", booking.paymentStatus],
    ], 143);
    drawSection(doc, "Customer & service", [
      ["Customer", booking.touristId?.name || "Customer"],
      ["Business", business?.name || "Assigned provider"],
      ["Service", serviceName],
    ], 239);
    drawSection(doc, "Schedule", [
      ["Booking date", formatDate(bookingDate)],
      ["Booking time", bookingTime],
      ["Quantity", booking.quantity || booking.guests || 1],
    ], 335);
    drawSection(doc, "Payment summary", [
      ["Agreed total", money(total)],
      ["Amount paid", money(amountPaid)],
      ["Remaining balance", money(remaining)],
    ], 431);

    doc.roundedRect(42, 527, 335, 112, 9).strokeColor(LINE).stroke();
    doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(10).text("PROVIDER DETAILS", 56, 541);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("CONTACT", 56, 565);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(clean(contact), 56, 578, { width: 300 });
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("FULL LOCATION", 56, 602);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(clean(business?.contactDetails?.exactAddress || business?.location), 56, 615, { width: 300, height: 18, ellipsis: true });

    doc.roundedRect(389, 527, 181, 112, 9).strokeColor(LINE).stroke();
    doc.image(qrBuffer, 400, 536, { fit: [80, 80] });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("Scan to verify", 486, 552, { width: 72 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text("Present this QR code at the service location.", 486, 569, { width: 72 });

    doc.roundedRect(42, 651, 528, 54, 9).fillAndStroke(PALE, LINE);
    doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(9).text("PAYMENT PURPOSE / REASON", 56, 662);
    doc.fillColor(INK).font("Helvetica").fontSize(9).text(clean(booking.paymentReason, "Approved booking payment"), 56, 677, { width: 330, height: 20, ellipsis: true });
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("REFERENCE", 405, 662);
    doc.fillColor(INK).font("Helvetica").fontSize(8).text(clean(transaction?.transactionId || booking.paymentReference), 405, 677, { width: 145, height: 20, ellipsis: true });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("Terms & Conditions", 42, 720);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(
      "This booking is valid after full payment and successful QR verification. Present this document when receiving the service.",
      42, 737, { width: 528, lineGap: 3 }
    );
    doc.moveTo(42, 790).lineTo(570, 790).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Generated ${formatDate(booking.receipt?.generatedAt || Date.now(), true)} - Re-download anytime from My Bookings`, 42, 803, { width: 528, align: "center" });
    doc.end();
  });
};

module.exports = { createPdfReceipt };
