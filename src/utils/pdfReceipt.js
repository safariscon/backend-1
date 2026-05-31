const escapePdf = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");

const line = (label, value) => `${label}: ${value || "-"}`;

const buildReceiptLines = ({ booking, business, transaction, verifyUrl }) => [
  "SafarisCon Marketplace",
  line("Receipt Number", booking.receipt?.receiptNumber || booking.bookingCode || booking._id),
  line("Date", new Date(booking.receipt?.generatedAt || Date.now()).toLocaleString()),
  "",
  "Customer",
  line("Name", booking.touristId?.name || "Customer"),
  line("Email", booking.touristId?.email || ""),
  line("Phone", booking.bookingDetails?.phone || ""),
  "",
  "Seller",
  line("Business", business?.name || "Pending assignment"),
  line("Seller Information", business?.sellerContactEmail || business?.ownerEmail || ""),
  "",
  "Booking",
  line("Booking ID", booking.bookingCode || booking._id),
  line("Service Name", booking.destinationPlace || business?.name || "Service"),
  line("Quantity", booking.quantity),
  line("Dates", [booking.checkIn && new Date(booking.checkIn).toLocaleDateString(), booking.checkOut && new Date(booking.checkOut).toLocaleDateString()].filter(Boolean).join(" - ")),
  line("Status", booking.status),
  "",
  "Payment",
  line("Amount", `${booking.amountPaid || booking.totalPrice || 0} RWF`),
  line("Status", booking.paymentStatus),
  line("Transaction ID", transaction?.transactionId || booking.paymentReference || ""),
  "",
  "QR Verification",
  line("Verification URL", verifyUrl),
  line("Verification Token", booking.verificationToken),
  "",
  "Terms",
  "Present this receipt and QR verification at the service location.",
  "Contact: SafarisCon support",
];

const createPdfReceipt = (details) => {
  const lines = buildReceiptLines(details);
  const content = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    `( ${escapePdf(lines[0])} ) Tj`,
    "/F1 10 Tf",
    ...lines.slice(1).flatMap((item) => ["0 -18 Td", `( ${escapePdf(item)} ) Tj`]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "binary");
};

module.exports = {
  createPdfReceipt,
};
