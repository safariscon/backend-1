const sendHotelCredentialsEmail = async ({
  hotelEmail,
  hotelName,
  ownerName,
  accessCode,
}) => {
  // Placeholder email integration.
  console.log(
    `[EMAIL SIMULATION] Sent onboarding email to ${hotelEmail} for hotel "${hotelName}" owner "${ownerName}". Access code: ${accessCode}. Owner must complete registration to set password.`
  );
};

module.exports = { sendHotelCredentialsEmail };
