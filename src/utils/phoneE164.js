const DIAL_CODES = {
  RW: "250",
  KE: "254",
  UG: "256",
  TZ: "255",
  BI: "257",
  CD: "243",
  US: "1",
  GB: "44",
  BE: "32",
  FR: "33",
  DE: "49",
  AE: "971",
  IN: "91",
  CN: "86",
  ZA: "27",
};

const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

const normalizePhone = ({ e164, iso, dialCode, nationalNumber, phone, value } = {}) => {
  const countryIso = String(iso || "").trim().toUpperCase() || "RW";
  const expectedDial = String(dialCode || DIAL_CODES[countryIso] || "").replace(/\D/g, "");
  let national = digitsOnly(nationalNumber);
  let raw = digitsOnly(e164 || phone || value);

  if (!raw && !national) {
    return { ok: false, message: "Phone number is required." };
  }

  if (national && expectedDial) {
    raw = `${expectedDial}${national.replace(new RegExp(`^${expectedDial}`), "")}`;
  }

  if (raw.startsWith("0") && expectedDial) {
    raw = `${expectedDial}${raw.slice(1)}`;
  }

  if (!raw.startsWith(expectedDial) && expectedDial && raw.length <= 10) {
    raw = `${expectedDial}${raw}`;
  }

  if (raw.length < 8 || raw.length > 15) {
    return { ok: false, message: "Phone number length is invalid." };
  }

  if (expectedDial && !raw.startsWith(expectedDial)) {
    return { ok: false, message: `Phone number must use country dial code +${expectedDial}.` };
  }

  const nationalOut = expectedDial ? raw.slice(expectedDial.length) : raw;
  return {
    ok: true,
    value: {
      iso: countryIso,
      dialCode: expectedDial ? `+${expectedDial}` : "",
      nationalNumber: nationalOut,
      e164: `+${raw}`,
    },
  };
};

const normalizeContactDetails = (input = {}) => {
  const phoneSource =
    input.phoneE164 || input.phone || input.phoneNumber
      ? {
          e164: input.phoneE164 || input.phone || input.phoneNumber,
          iso: input.phoneIso || input.iso || "RW",
          dialCode: input.phoneDialCode,
          nationalNumber: input.phoneNationalNumber,
        }
      : null;
  const whatsappSource =
    input.whatsappE164 || input.whatsapp
      ? {
          e164: input.whatsappE164 || input.whatsapp,
          iso: input.whatsappIso || input.phoneIso || input.iso || "RW",
          dialCode: input.whatsappDialCode,
          nationalNumber: input.whatsappNationalNumber,
        }
      : null;

  const result = {
    phoneE164: "",
    phoneIso: "",
    whatsappE164: "",
    whatsappIso: "",
    phone: "",
    whatsapp: "",
    email: String(input.email || "").trim().toLowerCase(),
    exactAddress: String(input.exactAddress || "").trim(),
    googleMapsUrl: String(input.googleMapsUrl || "").trim(),
    website: String(input.website || "").trim(),
    facebook: String(input.facebook || "").trim(),
    instagram: String(input.instagram || "").trim(),
    x: String(input.x || "").trim(),
    tiktok: String(input.tiktok || "").trim(),
    registrationDetails: String(input.registrationDetails || "").trim(),
    latitude: input.latitude == null ? null : Number(input.latitude),
    longitude: input.longitude == null ? null : Number(input.longitude),
  };

  if (phoneSource) {
    const phone = normalizePhone(phoneSource);
    if (!phone.ok) return phone;
    result.phoneE164 = phone.value.e164;
    result.phoneIso = phone.value.iso;
    result.phone = phone.value.e164;
  }

  if (whatsappSource) {
    const whatsapp = normalizePhone(whatsappSource);
    if (!whatsapp.ok) return { ok: false, message: `WhatsApp: ${whatsapp.message}` };
    result.whatsappE164 = whatsapp.value.e164;
    result.whatsappIso = whatsapp.value.iso;
    result.whatsapp = whatsapp.value.e164;
  }

  return { ok: true, value: result };
};

module.exports = {
  DIAL_CODES,
  normalizePhone,
  normalizeContactDetails,
};
