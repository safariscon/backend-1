const fail = (errors) => ({
  ok: false,
  message: Array.isArray(errors) ? errors[0] : String(errors || "Validation failed."),
  errors: Array.isArray(errors) ? errors : [String(errors || "Validation failed.")],
});

const ok = (value) => ({ ok: true, value, errors: [] });

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);

const asBoolean = (value) =>
  value === true || value === "true" || value === 1 || value === "1" || value === "yes";

const asNumber = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const asInteger = (value) => {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.trunc(parsed);
};

const asStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, 80)).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const asDateOnly = (value) => {
  const text = cleanText(value, 32);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const asDateTime = (value) => {
  const text = cleanText(value, 40);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const asTime = (value) => {
  const text = cleanText(value, 8);
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text.slice(0, 5);
  return "";
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const isPastDate = (dateOnly) => Boolean(dateOnly) && dateOnly < todayDate();

const nightsBetween = (start, end) => {
  if (!start || !end) return 0;
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

const pick = (source, keys) => {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
};

module.exports = {
  fail,
  ok,
  asObject,
  cleanText,
  asBoolean,
  asNumber,
  asInteger,
  asStringList,
  asDateOnly,
  asDateTime,
  asTime,
  todayDate,
  isPastDate,
  nightsBetween,
  pick,
};
