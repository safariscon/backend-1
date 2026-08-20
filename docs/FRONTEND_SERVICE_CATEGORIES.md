# Frontend integration guide — Service categories & schema-driven listings

Backend now owns **service categories**, **field schemas**, **options**, and **admin agreement terms** (cancel penalty % + platform commission %). Payment / wallet / hold / refund math is **unchanged**.

## Design choices (backend)

| Topic | Choice |
|--------|--------|
| Listing model | Existing `Hotel` collection = marketplace service/business |
| Options | New `ServiceOption` collection; synced into `availabilityTable` so automatic booking/pay still works |
| Lat/lng precision | `catalogLocation.latitude` / `longitude` as Number for queries; `latitudeRaw` / `longitudeRaw` as **strings** from geocoder for full precision round-trip |
| Commission storage | API accepts `platformCommissionPercent`; stored as existing `commissionPercentage` (payment code unchanged) |
| Schema edits | Category schemas snapshotted onto the service at create/update (`schemaSnapshot`) so later admin edits do not break old bookings |
| No options category | Seller must send `basePrice`; backend creates one implicit default availability row / option |
| Approve gate | If `supportsOptions`, at least one active option (or legacy availability row) required |
| Seller edit of approved service | Critical changes (title, category, attrs, location, images) reset `approvalStatus` → `pending` |

---

## Auth roles

- `admin`
- seller: `hotel` / `supplier`
- customer: `tourist` / `customer`

---

## 1) Categories API

### Public / seller (active only)

`GET /api/service-categories`  
`GET /api/hotel/service-categories` (seller; same payload)

Response:
```json
{
  "categories": [{ "_id": "...", "slug": "car-rental", "name": "Car Rental", "group": "Transport Services", "supportsOptions": true, "listingFieldSchema": [], "optionFieldSchema": [], "bookingFieldSchema": [], "defaults": { "suggestedCancelWindowHours": 6 }, "isActive": true, "sortOrder": 40 }],
  "groups": [{ "group": "Transport Services", "categories": [/*...*/] }]
}
```

`GET /api/service-categories/:idOrSlug`  
→ `{ "category": { /* full schemas */ } }`

### Admin CRUD

| Method | Path |
|--------|------|
| GET | `/api/admin/service-categories` |
| POST | `/api/admin/service-categories` |
| PUT | `/api/admin/service-categories/:id` |
| PUT | `/api/admin/service-categories/:id/fields` |
| DELETE | `/api/admin/service-categories/:id` (soft-deactivate) |

Create body example:
```json
{
  "name": "Car Rental",
  "slug": "car-rental",
  "group": "Transport Services",
  "supportsOptions": true,
  "listingFieldSchema": [
    { "id": "transmission", "label": "Transmission", "type": "select", "required": true, "options": ["Automatic", "Manual"], "visibility": "public", "appliesTo": "listing", "sortOrder": 1 }
  ],
  "optionFieldSchema": [],
  "bookingFieldSchema": [],
  "defaults": { "suggestedCancelWindowHours": 6 }
}
```

Field types: `text`, `textarea`, `number`, `tel`, `email`, `url`, `date`, `time`, `datetime-local`, `select`, `radio`, `checkbox`, `boolean`, `file`  
Visibility: `public` | `after_payment` | `internal`

---

## 2) Seller services

### List / get

- `GET /api/hotel/services?categoryId=` or `?categorySlug=car-rental`
- `GET /api/hotel/services/:id`

### Create / update

`POST /api/hotel/services`  
`PUT /api/hotel/services/:serviceId`

**Forbidden for seller (403 `SELLER_FORBIDDEN_FIELDS`):**
- `cancelPenaltyPercent`
- `platformCommissionPercent` / `commissionPercentage`
- `bookingMode`

Example body:
```json
{
  "categoryId": "<id>",
  "title": "Kigali Airport Transfers",
  "description": "...",
  "status": "available",
  "primaryImage": "https://cdn.../cover.jpg",
  "images": ["https://cdn.../cover.jpg", "https://cdn.../2.jpg"],
  "location": {
    "latitude": -1.9686,
    "longitude": 30.1395,
    "latitudeRaw": "-1.9686123456789",
    "longitudeRaw": "30.1395123456789",
    "formattedAddress": "...",
    "country": "Rwanda",
    "countryCode": "RW",
    "state": "Kigali City",
    "city": "Gasabo",
    "area": "Remera",
    "placeName": "...",
    "placeId": "osm:N:123",
    "locationSource": "search"
  },
  "contactDetails": {
    "phoneE164": "+250788000000",
    "phoneIso": "RW",
    "whatsappE164": "+250788000001",
    "whatsappIso": "RW"
  },
  "listingAttributes": {
    "transmission": "Automatic",
    "vehicleClass": "SUV"
  },
  "rebookSettings": { "requestDeadlineHours": 24, "rebookIdValidityHours": 72 }
}
```

Images: `primaryImage` optional; `images[]` max **5**. List UI: `primaryImage || images[0]`.  
Upload: `POST /api/hotel/uploads/images` still works; max **5** files per request.

If category `supportsOptions === false`, also send `basePrice` (RWF).

### Options (only if `supportsOptions`)

| Method | Path |
|--------|------|
| GET | `/api/hotel/services/:serviceId/options` |
| POST | `/api/hotel/services/:serviceId/options` |
| PUT | `/api/hotel/services/:serviceId/options/:optionId` |
| DELETE | `/api/hotel/services/:serviceId/options/:optionId` |

```json
{
  "name": "Premium SUV",
  "price": 85000,
  "currency": "RWF",
  "priceType": "per-day",
  "calculationField": "duration",
  "durationUnit": "days",
  "capacity": 2,
  "attributes": { "seats": 5, "ac": true }
}
```

---

## 3) Admin approve (agreement terms)

`PUT /api/admin/services/:id/approval`

Approve (both required):
```json
{
  "status": "approved",
  "cancelWindowHours": 6,
  "cancelPenaltyPercent": 20,
  "platformCommissionPercent": 10,
  "notes": "Agreement signed 2026-08-01"
}
```

Missing terms → `400` `AGREEMENT_TERMS_REQUIRED`.

Reject:
```json
{ "status": "rejected", "reason": "Incomplete photos / unclear location" }
```

`GET` service returns:
- `cancelPenaltyPercent`
- `platformCommissionPercent` (alias of `commissionPercentage`)
- `agreementTerms`

Booking mode stays on marketplace settings / per-service admin booking-mode endpoints — **not** on seller create form.

---

## 4) Customer booking (payment unchanged)

Create booking as today (`POST /api/bookings/...` existing route). Add:

```json
{
  "hotelId": "<serviceId>",
  "optionId": "<optionId>",
  "bookingAttributes": {
    "pickupLocation": "...",
    "returnLocation": "...",
    "pickupDateTime": "2026-09-01T10:00",
    "returnDateTime": "2026-09-03T10:00",
    "driverLicenseNumber": "RWxxxx",
    "numberOfDrivers": 1
  },
  "quantity": 1,
  "numberOfPeople": 1
}
```

Validated against **`service.schemaSnapshot.bookingFieldSchema`**.  
Then existing pay flow is unchanged:

1. Confirm / wait-for-payment (manual or automatic)
2. `POST /api/bookings/:id/pay`
3. Poll payment status
4. Unlock `after_payment` fields only when paid (same as today)

Do **not** change pay UI contracts beyond collecting `bookingAttributes`.

---

## 5) Geo (location picker)

Keep:
- `GET /api/geo/search?q=`
- `GET /api/geo/reverse?lat=&lng=`
- `GET /api/geo/route?...`

Search results now include structured parts when available:
`formattedAddress`, `country`, `countryCode`, `state`, `city`, `area`, `province`, `district`, `sector`, `latitude`, `longitude`, `latitudeRaw`, `longitudeRaw`, `placeId`.

Frontend picker:
- Debounced search overlay on map (no manual Search button)
- On select / map click / geolocation → reverse geocode → auto-fill address parts
- Persist `latitudeRaw` / `longitudeRaw` from the geocoder string when present

---

## 6) Screen map

### Admin
1. **Categories list** — `/dashboard/admin/service-categories`
2. **Category editor + field-schema builder** — listing / option / booking tabs
3. **Approve service** — form fields: cancel window hours, cancel penalty %, platform commission %, notes
4. Marketplace settings (booking mode) — existing screen; not on seller form

### Seller
1. `/dashboard/seller/services` — group by category
2. `/dashboard/seller/services/categories/:slug` — services in that category
3. Add/edit service — dynamic form from `listingFieldSchema`
4. Options page — only if `supportsOptions`
5. Phone fields — reuse `PhoneNumberField` → send `phoneE164` + `phoneIso` (and WhatsApp)
6. Images — optional cover + up to 5 gallery; preview + remove (X)
7. **Remove from create form:** booking mode banner, cancel penalty %, booking form preview, automatic quote preview

### Customer
1. Public list — `primaryImage || images[0]`
2. Booking form — render `schemaSnapshot.bookingFieldSchema` (or live category if snapshot missing)
3. Hide `after_payment` answers until paid (license number etc. can still be collected at booking if schema marks them required — visibility is for display unlock of provider contact/location; booking answers are stored on the booking)

### Replace hardcoded categories
Delete / stop importing `frontend-1/src/data/serviceCategories.js`. Load from `GET /api/service-categories`.

---

## 7) Migration commands (backend)

```bash
npm run seed:categories          # idempotent seed if empty
npm run migrate:categories       # link existing Hotel.type → categoryId + migrate availability rows → options
```

Seed packs included: hotel, apartment, homestay, car-rental, taxi, motorbike, tour, activity-operator, conference, event-hall, restaurant, cafe, bar, other.

---

## 8) Acceptance checklist (frontend QA)

- [ ] Admin creates/edits category fields → seller form updates after refetch
- [ ] Seller create with `cancelPenaltyPercent` → 403
- [ ] Admin approve without commission/penalty → 400
- [ ] Admin approve with both → GET shows values
- [ ] Option create on `supportsOptions:false` → 400
- [ ] Booking missing required `bookingAttributes` → 400
- [ ] Pay endpoint still works for confirmed booking
- [ ] Public cards use `primaryImage || images[0]`
