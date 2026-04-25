const sendHotelCredentialsEmail = async ({
  hotelEmail,
  hotelName,
  ownerName,
}) => {
  // Placeholder email integration.
  console.log(
    `[EMAIL SIMULATION] Sent onboarding email to ${hotelEmail} for hotel "${hotelName}" owner "${ownerName}". Owner must complete registration to set password.`
  );
};

module.exports = { sendHotelCredentialsEmail };
