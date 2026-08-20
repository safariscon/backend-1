const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "tel",
  "email",
  "url",
  "date",
  "time",
  "datetime-local",
  "select",
  "radio",
  "checkbox",
  "boolean",
  "file",
];

const VISIBILITIES = ["public", "after_payment", "internal"];
const APPLIES_TO = ["listing", "option", "booking"];

const fieldSchemaItem = () => ({
  id: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: FIELD_TYPES, default: "text" },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: "", trim: true },
  helpText: { type: String, default: "", trim: true },
  options: { type: [String], default: [] },
  validation: {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    pattern: { type: String, default: null },
  },
  visibility: { type: String, enum: VISIBILITIES, default: "public" },
  appliesTo: { type: String, enum: APPLIES_TO, default: "listing" },
  sortOrder: { type: Number, default: 0 },
});

module.exports = {
  FIELD_TYPES,
  VISIBILITIES,
  APPLIES_TO,
  fieldSchemaItem,
};
