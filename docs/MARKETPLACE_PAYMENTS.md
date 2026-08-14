# SafarisCon payments — frontend integration

This is the only document a frontend developer needs for payment, payout, cancellation, and **home-page trust copy** (how we authenticate, handle data, take payments, and refund).

- Base URL: same as today (`/api/...`).
- Auth: `Authorization: Bearer <accessToken>` on every route below except `GET /api/payments/methods`.
- Hotel routes are also mounted at `/api/seller/...` (same handlers as `/api/hotel/...`).
- Do **not** rename existing screens or delete old components. Patch labels, amounts, and a few fields.
- **Home page:** add Terms, Privacy, and How bookings work. Ready-to-paste copy is in **§14**.

**Compatibility rule:** keep using current field names. The backend still returns `depositAmount`, `depositPercent`, `depositPaid`, `detailsUnlocked`, `paymentStatus: "deposit_paid" | "paid"`. They now mean **full payment**, not 30%.

---

## 0. What changed (map old UI → new)

| Old frontend logic | New logic (do this) |
|---|---|
| Charge 30% (`depositAmount` or `totalPrice * 0.3`) | Charge **`totalPrice`**. If you already bind the pay button to `depositAmountRequired` / `depositAmount`, that field is now the **full price**. You can leave the binding. |
| Show “remaining 70% at the venue” | Hide it. `remainingBalance` is `0` after pay. |
| Unlock details after deposit | Unchanged. Still `detailsUnlocked` / `providerDetailsUnlocked` / `depositPaid`. |
| Treat paid as `paymentStatus === "deposit_paid"` | Keep that check. Also accept `"paid"`. Helper: `["deposit_paid","deposit-paid","paid"].includes(status)` |
| Pay hotel immediately after collection | Do not say that. Money stays in the SafarisCon wallet until the cancel window ends. |
| Weekly settlement / SET batches / held-until-complete | Removed. Do not call `/api/admin/settlements`. |
| Cancel = 20% of the 30% deposit | Cancel = guest loses `cancellation.penaltyPercent` of **what they paid** (default 20% of 100%). |
| Complete booking collects remaining 70% | Completion only verifies the code. No extra payment. |

Safe amount helper (keeps old property names working):

```js
const isPaid = (b) =>
  b?.depositPaid === true ||
  b?.detailsUnlocked === true ||
  ["deposit_paid", "deposit-paid", "paid"].includes(b?.paymentStatus);

const amountDueNow = (b) =>
  Number(b?.totalPrice || b?.depositAmount || b?.lockedDetails?.visible?.depositAmountRequired || 0);

const remainingAtVenue = (b) => Number(b?.remainingBalance || b?.remainingAmount || 0); // expect 0 after pay
```

---

## 1. Product flow (for copy, not new routes)

```text
Guest pays 100% in the app
        → money in SafarisCon XentriPay wallet
        → booking PAID, details unlocked, guest can travel with booking code

Until cancel deadline (e.g. 6 hours before service)
        → guest MAY cancel
        → loses 20% (example), gets 80% back
        → of the 20%: platform takes half-commission (10% → 5% of the 20%), provider gets the rest

After cancel deadline
        → cancel button hidden
        → backend pays provider their share (90% if they did not cancel)
        → platform keeps commission in the wallet
        → admin confirms XentriPay OTP
```

Example: 100,000 booked, 10% commission, 20% cancel fee, 6-hour window.

| Outcome | Guest | Platform | Provider |
|---|---|---|---|
| No cancel | 0 back | 10,000 | 90,000 after window |
| Cancel in time | 80,000 back | 1,000 (5% of 20,000) | 19,000 |

---

## 2. Routes you already have (keep calling them)

### Public / shared

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/payments/methods` | anyone | Pay + payout dropdowns |
| GET | `/api/payments/providers` | anyone | Same payload as `/methods` |

### Customer (`customer` role)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/bookings/request` | Create booking (unchanged) |
| GET | `/api/bookings/my` | List + pay/cancel state |
| POST | `/api/bookings/:bookingId/pay` | Start MoMo or card |
| GET or POST | `/api/bookings/:bookingId/payment-status` | Poll until paid/failed |
| POST | `/api/bookings/:bookingId/cancel` | Cancel inside the window |
| GET | `/api/bookings/:bookingId/receipt` | PDF after paid |

### Provider (`hotel` / `supplier`) — `/api/hotel` or `/api/seller`

| Method | Path | Purpose |
|---|---|---|
| GET | `/payout-details` | Load settlement account |
| PUT | `/payout-details` | Save MoMo/bank (not on service form) |
| POST | `/services` | Create listing + cancel rules |
| PUT | `/services/:serviceId` | Update listing + cancel rules |
| GET | `/overview` | Stats + `cancellationTerms` |
| GET | `/finance` | Earnings + payout rows |
| GET | `/bookings` | Provider bookings |
| POST | `/bookings/verify-code` | Scan/enter booking code |
| POST | `/bookings/complete-verified` | Mark stay done (no 70% cash) |

### Admin

| Method | Path | Purpose |
|---|---|---|
| PUT | `/api/admin/businesses/:businessId/verification` | Approve + `commissionPercentage` |
| GET | `/api/admin/finance` | Platform totals |
| GET | `/api/admin/payouts` | Payout queue |
| POST | `/api/admin/payouts/:transactionId/sync` | After merchant OTP |

**Do not call** `/api/admin/settlements` (gone).

---

## 3. Payment catalog

`GET /api/payments/methods`

Use this once for customer pay buttons and provider payout dropdowns.

```json
{
  "currency": "RWF",
  "minAmount": 100,
  "configured": true,
  "environment": "test",
  "platformCommissionPercentage": 12,
  "collectionMethods": [
    { "id": "momo", "name": "Mobile Money", "aliases": ["mobile-money", "momo", "mtn", "airtel"] },
    { "id": "cc", "name": "Card", "aliases": ["cc", "card", "credit-card", "debit-card"] }
  ],
  "payoutMethods": [
    { "id": "momo", "name": "Mobile Money" },
    { "id": "bank", "name": "Bank transfer" }
  ],
  "mobileMoneyProviders": [
    { "id": "63510", "name": "MTN MOBILE MONEY", "method": "momo" },
    { "id": "63514", "name": "AIRTEL RWANDA", "method": "momo" },
    { "id": "63509", "name": "SPENN", "method": "momo" }
  ],
  "bankProviders": [
    { "id": "040", "name": "BANQUE DE KIGALI", "method": "bank" }
  ]
}
```

Rules:

- Customer pay `pmethod` must be `"momo"` or `"cc"` (aliases `mobile-money` / `card` also accepted).
- Provider payout `method` must be `"momo"` or `"bank"`. Never card.
- Payout `providerId` must be the catalog `id` string (`"63510"`, `"040"`, …).

---

## 4. Customer — booking list (keep your list screen)

`GET /api/bookings/my` → `{ bookings: [...] }`

### Unpaid (keep locked UI)

Still use:

- `detailsUnlocked === false`
- `lockedDetails.visible.price` — full price
- `lockedDetails.visible.depositAmountRequired` — **amount to charge now (full price)**
- `lockedDetails.visible.message`

Do not compute 30% yourself.

### Paid (keep unlock UI)

Still use `detailsUnlocked`, `providerDetailsUnlocked`, `depositPaid`, hotel contact/location.

**New fields (add, do not replace old ones):**

| Field | Use |
|---|---|
| `canCancel` | Show Cancel only if `true` |
| `cancellation.refundableUntil` | ISO date — last moment they can cancel |
| `cancellation.penaltyPercent` | e.g. 20 |
| `cancellation.windowHours` | e.g. 6 |
| `cancellationPreview` | Confirm-dialog numbers, or `null` if they cannot cancel |

`cancellationPreview` shape:

```json
{
  "paidAmount": 100000,
  "penaltyPercent": 20,
  "penaltyAmount": 20000,
  "refundAmount": 80000,
  "refundPercent": 80,
  "cancelCommissionPercent": 5,
  "platformAmount": 1000,
  "providerAmount": 19000
}
```

Customer UI should only show `refundAmount`, `penaltyAmount`, `penaltyPercent`, `refundableUntil`. Do **not** show `platformAmount` / `providerAmount` / commission to the guest.

Pay button amount = `amountDueNow(booking)` (full `totalPrice`).

---

## 5. Customer — pay (keep your pay screen)

Only change the **amount label** (full price) and success copy. Same endpoint.

`POST /api/bookings/:bookingId/pay`

Headers: `Authorization`, `Content-Type: application/json`

MoMo body (phone must be 10 digits `07XXXXXXXX`):

```json
{
  "pmethod": "momo",
  "email": "guest@example.com",
  "cname": "John Doe",
  "cnumber": "0780371519"
}
```

Accepted aliases: `paymentMethod`, `method`, `name`, `phone`.

Card body:

```json
{
  "pmethod": "cc",
  "email": "guest@example.com",
  "cname": "John Doe",
  "cnumber": "0780371519",
  "redirecturl": "https://your-app.example/payments/callback",
  "returl": "https://your-app.example/payments/return"
}
```

If you already send `redirecturl` / `returl` / `gatewayRedirectUrl` / `customerFinalUrl`, keep them.

### Handle `code` (keep your switch)

**`PAYMENT_PENDING`**

```json
{
  "code": "PAYMENT_PENDING",
  "message": "Mobile Money payment started. Ask the customer to approve the prompt on their phone, then poll payment status.",
  "booking": {},
  "transaction": {},
  "collection": {
    "refid": "PAY-...",
    "tid": "...",
    "url": null,
    "pmethod": "momo"
  },
  "split": {
    "collectedAmount": 100000,
    "commissionPercentage": 10,
    "platformAmount": 10000,
    "providerAmount": 90000
  },
  "amount": 100000,
  "remainingBalance": 0
}
```

- `collection.pmethod === "momo"` or no `url` → “Approve the prompt on your phone.”
- `collection.url` present (card) → `window.location = collection.url` (also on `transaction.checkoutUrl`).
- Then poll every 4–6 seconds, stop on success/fail/~3 minutes:

`GET /api/bookings/:bookingId/payment-status`  
(POST to the same path still works.)

**`PAYMENT_SUCCESS`** or **`PAYMENT_ALREADY_RECORDED`**

Treat both as success. Unlock details, show QR/receipt. Do not start pay again.

```json
{
  "code": "PAYMENT_SUCCESS",
  "message": "Full payment collected into the SafarisCon wallet. ...",
  "booking": {},
  "transaction": {},
  "split": {},
  "qr": {}
}
```

After success:

- `booking.paymentStatus` is `"paid"` (old `"deposit_paid"` may still appear — treat both as paid).
- `booking.amountPaid` = full price.
- `booking.remainingBalance` = `0`.
- `booking.cancellation.refundableUntil` is set.

Success copy:

> Paid in full. Show your booking code at the venue. You can cancel until {refundableUntil}. If you cancel before then, you get 80% back and 20% is a cancellation fee.

Do not show `split` to the customer. Do not say the hotel was paid.

**`PAYMENT_FAILED`** — HTTP 402. Allow retry.

**Errors**

| HTTP | When | UI |
|---|---|---|
| 400 | Missing quote, bad phone/email/name, booking not ready | Show `message` |
| 409 | Deadline/quote expired, **or provider has no payout details** | Show `message`. If payout details missing, “This listing cannot accept payment yet.” |
| 402 | MoMo/card declined | Retry |
| 404 | Booking not found | Back to list |

---

## 6. Customer — cancel (keep your cancel button, add confirm)

1. If `canCancel !== true` → hide Cancel.
2. Confirm using `cancellationPreview`:

> Cancel this booking? You get **{refundAmount} RWF** back. **{penaltyAmount} RWF** ({penaltyPercent}%) is kept as a cancellation fee. Refund can take a short time to reach your MoMo.

3. Then:

`POST /api/bookings/:bookingId/cancel`

```json
{ "reason": "Plans changed" }
```

(`cancellationReason` also accepted.)

Success:

```json
{
  "message": "Booking cancelled. 80,000 RWF will be returned to you. 20,000 RWF stays as the cancellation fee ...",
  "booking": {},
  "split": {
    "paidAmount": 100000,
    "penaltyPercent": 20,
    "penaltyAmount": 20000,
    "refundAmount": 80000,
    "cancelCommissionPercent": 5,
    "platformAmount": 1000,
    "providerAmount": 19000
  }
}
```

Show only refund + fee to the guest.

**409** if window closed:

```json
{
  "message": "The cancellation window has closed. The booking stays paid and the provider will receive their share.",
  "refundableUntil": "2026-08-15T08:00:00.000Z"
}
```

Hide Cancel after that. Booking stays valid for the venue.

Unpaid bookings: 409 “has not been paid yet” — do not offer cancel-for-refund on unpaid items (user can still drop an unpaid request via existing status flows if you have them).

---

## 7. Provider — settlement account (keep settings screen)

Do **not** put these fields on create/update service. Existing payout-details page stays.

`GET /api/hotel/payout-details`

```json
{
  "payoutDetails": {
    "method": "momo",
    "providerId": "63510",
    "providerName": "MTN MOBILE MONEY",
    "accountName": "Hotel ABC",
    "accountNumber": "0780000000",
    "msisdn": "0780000000",
    "verified": false
  },
  "businessId": "...",
  "businessName": "Hotel ABC"
}
```

`PUT /api/hotel/payout-details`

```json
{
  "payoutDetails": {
    "method": "momo",
    "providerId": "63510",
    "accountName": "Hotel ABC",
    "accountNumber": "0780000000"
  }
}
```

Bank:

```json
{
  "payoutDetails": {
    "method": "bank",
    "providerId": "040",
    "accountName": "Hotel ABC Ltd",
    "accountNumber": "1234567890"
  }
}
```

If GET is empty, block publishing pay-enabled listings and send them to this screen. Customer pay returns 409 until this is saved.

---

## 8. Provider — create / update service (keep the form)

Same `POST /api/hotel/services` and `PUT /api/hotel/services/:serviceId` as today.

**Add two optional numbers** (defaults: window 6 hours, penalty 20%):

```json
{
  "title": "Serena Rubavu",
  "category": "hotel",
  "cancelWindowHours": 6,
  "cancelPenaltyPercent": 20
}
```

Equivalent:

```json
{
  "cancellationPolicy": {
    "windowHours": 6,
    "penaltyPercent": 20
  }
}
```

Do not send `payoutDetails` here. If you still send them, backend ignores them.

Show on the form:

- Hours before the service when cancel closes (`cancelWindowHours`)
- Percent the guest loses if they cancel (`cancelPenaltyPercent`)

Returned listing includes:

```json
{
  "cancelWindowHours": 6,
  "cancelPenaltyPercent": 20,
  "commissionPercentage": 10,
  "commissionTerms": {
    "percentage": 10,
    "label": "10% platform commission"
  },
  "cancellationTerms": {
    "windowHours": 6,
    "penaltyPercent": 20,
    "cancelCommissionPercent": 5,
    "description": "Customers may cancel until 6 hours before the service. They lose 20% of what they paid. SafarisCon keeps 5% of that fee; the rest goes to you."
  }
}
```

Public listing copy (customer, no commission numbers):

> Free to visit after you pay in the app. Cancel until 6 hours before. Cancellation fee 20%.

---

## 9. Provider — overview & finance (keep dashboards)

`GET /api/hotel/overview`

`stats` (use these; ignore missing old keys):

| Field | Meaning |
|---|---|
| `earnings` | Provider share from paid collections |
| `commission` | Platform commission |
| `pendingPayout` | Held in wallet or waiting OTP |
| `paidOut` | XentriPay marked successful |

Old keys `pendingSettlement` / `availableForPayout` / `finance` are **gone**. If your UI still reads them, fallback:

```js
const pending = stats.pendingPayout ?? stats.pendingSettlement ?? 0;
const paidOut = stats.paidOut ?? stats.availableForPayout ?? 0;
```

`GET /api/hotel/finance`

```json
{
  "message": "...",
  "summary": {
    "grossCollected": 100000,
    "commission": 10000,
    "providerEarnings": 90000,
    "pendingPayout": 90000,
    "paidOut": 0,
    "failedPayout": 0
  },
  "transactions": []
}
```

Table columns from `transactions[]`:

| UI | Field |
|---|---|
| Booking | `bookingId.bookingCode` |
| Gross | `amount` |
| Commission | `platformAmount` |
| Your share | `providerAmount` |
| Status | `payoutStatus` |
| Payout id | `payoutReference` |
| Destination | `payoutAccount` |
| Note | `payoutMessage` |

`payoutStatus` copy:

| Value | Label |
|---|---|
| `held` | Guest paid. Waiting until cancel window ends. Not in your account yet. |
| `pending` | Payout sent to XentriPay. SafarisCon confirming OTP. |
| `successful` | Paid to your MoMo/bank |
| `failed` | Failed. Contact SafarisCon |
| `reversed` | Booking cancelled/refunded |
| `none` | No payout yet |

If the guest cancelled, `providerAmount` is their share of the **fee**, not 90% of the full booking.

**Completion:** keep `verify-code` + `complete-verified`. Remove any “collect remaining 70%” checkbox/copy. Message is only “booking completed”.

---

## 10. Admin (keep finance; drop settlements)

Approve + commission (unchanged shape):

`PUT /api/admin/businesses/:businessId/verification`

```json
{ "status": "approved", "commissionPercentage": 10 }
```

Cancel commission is computed as half of this. Frontend does not send it.

`GET /api/admin/finance`

```json
{
  "summary": {
    "grossBookingPayments": 0,
    "platformRevenue": 0,
    "providerPayables": 0,
    "paidBookings": 0,
    "pendingPayouts": 0,
    "successfulPayouts": 0,
    "failedPayouts": 0
  }
}
```

`GET /api/admin/payouts?page=1&limit=25&payoutStatus=pending`  
Also filter `held`.

`POST /api/admin/payouts/:transactionId/sync` after OTP in the XentriPay merchant app.

On cancelled rows, also show `refundPayoutStatus` / `refundPayoutReference` (guest 80% return). Sync the same transaction after OTP.

If the admin UI still has “Weekly settlements / Run settlement”, remove those buttons only. Keep the payouts table.

---

## 11. Copy-paste UI states

### Customer `paymentStatus`

| Value | Screen |
|---|---|
| `unpaid` / missing | Show Pay (`amountDueNow`) |
| `pending` | MoMo prompt / card redirect + poll |
| `deposit_paid` or `paid` | Paid in full, unlock, QR, Cancel if `canCancel` |
| `failed` | Retry pay |
| `refunded` | Cancelled; show `refundAmount` |
| `completed` | Stay finished |

### Do not break

- Booking request form
- Manual vs automatic booking
- Room CRUD
- Image upload
- Verify booking code
- Auth / OTP login
- Receipt download after paid

---

## 12. Manual check (no backend tests)

1. Provider saves payout details, creates service with window 6 / penalty 20.
2. Admin approves at 10% commission.
3. Customer list shows full price in `depositAmountRequired`. Pays MoMo → details unlock, remaining 0, `canCancel` true.
4. Cancel → preview 80k / 20k → success. Provider finance shows ~19k, not 90k.
5. New paid booking, do not cancel. After window, payout goes `held` → `pending`. Admin OTP + Sync → `successful`.
6. Cancel after window → 409, booking still usable at the venue.

---

## 13. Field cheat sheet

```js
// pay now
booking.totalPrice
booking.depositAmount                 // now equals full price
booking.lockedDetails.visible.depositAmountRequired

// paid?
booking.depositPaid
booking.detailsUnlocked
booking.paymentStatus                 // "paid" or "deposit_paid"

// leftover at venue — expect 0
booking.remainingBalance
booking.remainingAmount

// cancel
booking.canCancel
booking.cancellation.refundableUntil
booking.cancellation.penaltyPercent
booking.cancellationPreview.refundAmount
booking.cancellationPreview.penaltyAmount

// provider money
transaction.amount
transaction.platformAmount
transaction.providerAmount
transaction.payoutStatus              // held | pending | successful | failed
```

---

## 14. Home page — Terms, Privacy, and How SafarisCon works

**Frontend task:** put this on the **home page** so guests and providers can trust the product before they sign up. Do not bury it only in a checkout checkbox.

This copy matches the live backend. Do not invent extra promises (for example “instant hotel payout”, “30% deposit”, or “we never store payment data”). Have legal review the wording before production; until then use this product-accurate text.

### 14.1 Where to put it (do not skip)

Keep existing home sections. **Add** a trust block near the bottom of the home page, then link the same pages from the footer and from register / pay / cancel.

| Placement | What to add |
|---|---|
| Home page, below the main hero / listings | A short “How SafarisCon works” strip (3–5 bullets from §14.3) + buttons: **Terms**, **Privacy**, **Payments & refunds** |
| Footer (every page) | `How it works` · `Terms of use` · `Privacy policy` · `Payments & cancellations` |
| Register / login | Short line: “By creating an account you agree to our Terms and Privacy Policy.” Link those pages. |
| Pay confirm | One line: “You pay the full amount now. Money is held until the cancel window ends. See Payments & refunds.” |
| Cancel confirm | Keep using `cancellationPreview` numbers. Link “Payments & cancellations” for the full policy. |
| Provider payout-details page | One line: “We store your MoMo or bank details only to pay you after the guest cancel window.” |

Suggested routes (create them if they do not exist; reuse if they do):

- `/how-it-works` — guest-facing product explanation
- `/terms` — Terms of use
- `/privacy` — Privacy policy
- `/payments` — Payments, holding, cancellation, refunds

On the **home page itself**, render a compact version of §14.3 (the 6 steps). The four routes above get the full text from §14.4–§14.7. Same copy, not four different stories.

Use an accordion or tabs on `/terms` if you want one long legal page instead of four routes. Either is fine. The home page must still show the short “how bookings work” summary.

**Do not show guests:** platform commission %, `platformAmount`, `providerAmount`, XentriPay merchant OTP, admin payout queue, or wallet internals.

**Do show guests:** full price, when details unlock, cancel deadline, refund vs fee, that money is held (not sent to the hotel at the moment of pay).

---

### 14.2 Suggested home-page UI

```text
[How SafarisCon works]
  1. Browse listings without seeing the hotel’s private details
  2. Request a booking (sign in)
  3. Pay 100% in the app (MoMo or card)
  4. Details, contact, and your booking code unlock
  5. Cancel in time → most of your money comes back; a listed fee is kept
  6. After the cancel window, the provider is paid; you visit with your code

[Read our policies]
  [Terms of use]  [Privacy]  [Payments & refunds]
```

Bind cancel hours / fee on a **listing** from that listing’s `cancellationTerms` (defaults: 6 hours, 20%). On the **home page**, use the default wording below, and say “each listing shows its own cancel window and fee.”

---

### 14.3 Home-page short copy (paste)

**Title:** How SafarisCon works

**Lead:** SafarisCon is a booking marketplace. You pay in the app. We hold the money, protect provider details until you pay, and only then you get what you need to travel.

**Steps (guest):**

1. **Browse safely.** Public listings hide the provider’s real name, phone, and exact address. You see category, area, photos, and price.
2. **Create an account.** Email and password, then we verify your email with a one-time code. Login is password plus a code we email you.
3. **Request a booking.** Some listings confirm automatically; others wait for the provider. Either way, you pay the **full price** in the app — not a 30% deposit, and not cash at the venue.
4. **Pay with Mobile Money or card.** Payment goes to the **SafarisCon wallet**, not straight to the hotel. When payment succeeds, provider details and your booking code unlock.
5. **Cancel only while the window is open.** Default: until **6 hours** before the service, you can cancel and get **80%** back; **20%** is a cancellation fee. The listing may set different hours and %. After the deadline, Cancel is hidden and the booking stays valid.
6. **Show your code at the venue.** The provider checks it. There is no second payment on arrival.

**Trust line:** We do not publish your password. We do not show the hotel your card number. We do not send the hotel the full booking amount the second you pay.

---

### 14.4 How we authenticate (for `/how-it-works` + Terms)

Paste this under a heading **Accounts and sign-in**.

**Who can register**

- Guests (customers) create their own account with name, email, and password.
- Hotels and other providers do **not** self-register. SafarisCon invites them; they finish onboarding, set a password, and add payout details before they can collect payments.

**Email verification**

- After sign-up we email a 6-digit code. It expires in about **10 minutes**. You can request a new code after **60 seconds**. Too many wrong attempts lock that code and you must request a new one.
- You must verify email before a normal login is allowed.

**Login (two steps)**

1. Email + password.
2. We email a one-time login code (same 10-minute / 60-second / attempt limits). Only after that code is correct do we start a session.

**Sessions**

- You get a short-lived access token (about **2 hours**). Send it as `Authorization: Bearer …` on private API calls.
- If you tick **Remember me**, we also issue a refresh token (about **1 day**) so you can stay signed in without repeating the full login every two hours.
- **Log out** ends the refresh session on the server. Always offer a visible Log out.

**Passwords**

- Stored hashed (not readable by staff or the app). Reset is email OTP + new password (at least 8 characters). We do not email you the old password.

**What this means for UI**

- Keep the existing OTP login / verify-email / forgot-password screens. On the home page, say “We protect accounts with email verification and a login code, not password-only access.”

---

### 14.5 Privacy policy copy (for `/privacy`)

**Title:** Privacy policy — how we handle your data

**What we collect**

| Data | Why |
|---|---|
| Name, email, phone | Account, booking contact, receipts, OTP login |
| Password | Sign-in only (stored hashed) |
| Booking dates, times, guest counts, destination | To create and fulfil the booking |
| Your location fields (province, district, sector, cell, village) | Required on booking requests so the provider can plan the service |
| Payment name, email, and MoMo number (or card checkout via the processor) | To collect the booking amount |
| Provider MoMo / bank payout details | To pay the provider after the cancel window — **not** shown to guests |
| Listing photos | Shown on the marketplace (stored with our image host) |
| Product analytics | Page views, listing views, booking and pay events. We store a **hashed** IP, device type, and browser — not a raw IP address in the event record |

**What we do not do**

- We do not sell your personal data.
- We do not show other customers your email, phone, or booking.
- We do not put the provider’s phone, exact address, or map pin on the public home page.
- We do not store your card PIN or MoMo PIN. Card checkout happens on the payment provider’s page. MoMo approval happens on your phone.

**When provider details are hidden vs unlocked**

- **Before you pay:** listings use an anonymous name (for example “Hotel 1”). You may see district / area and photos. Phone, exact address, and directions stay locked.
- **After you pay in full:** that booking unlocks provider identity, contact, and location for **you**. Other users still see the anonymous listing.

**Who else processes data**

- **XentriPay** — collects MoMo/card payments into the SafarisCon merchant wallet and later pays providers / refunds guests.
- **Email delivery** — OTP and booking messages.
- **Image hosting** — listing and receipt files.

**Your controls**

- Update profile name / phone where the account screen already allows it.
- Log out to end the remembered session.
- Providers update payout details on the existing payout-details page (not on the public listing form).
- For account deletion or a data export, contact SafarisCon support (add your support email in the footer). There is no self-serve delete API in this document yet — do not promise an in-app “delete my account” button unless you build it.

**Security measures the product already uses (you may mention these)**

- HTTPS, hashed passwords, hashed OTPs, Bearer tokens, role checks (customer / provider / admin), CORS, and security headers.
- Private booking and pay routes require a signed-in user. You can only pay or cancel **your** bookings.

---

### 14.6 Payments, holding, cancellation, refunds (for `/payments` and home-page policy)

**Title:** Payments, cancellations, and refunds

**Paying for a booking**

- Currency is **RWF**. Methods: **Mobile Money** (MTN, Airtel, and others in `GET /api/payments/methods`) or **card**.
- You pay the **full listing price** in the app. There is no 30% deposit and no remaining 70% at the venue.
- Money is collected into the **SafarisCon wallet**. The hotel is **not** paid at that moment.
- Minimum charge follows the catalog (`minAmount`, typically 100 RWF).
- A listing cannot be paid until the provider has saved valid MoMo or bank payout details. If pay returns that error, show: “This listing cannot accept payment yet.”

**After a successful payment**

- The booking is paid in full. `remainingBalance` is 0.
- Provider details and your booking code / QR / receipt unlock.
- You can cancel only until `cancellation.refundableUntil` (`canCancel === true`).
- Show this success idea (fill the time from the booking):

> Paid in full. Show your booking code at the venue. You can cancel until {refundableUntil}. If you cancel before then, you get your refund minus the listing’s cancellation fee.

**Cancellation (guest)**

- Only **paid** bookings can be cancelled for a refund. Unpaid requests have nothing to refund.
- The listing sets **hours before the service** when cancel closes (default **6**) and **percent of what you paid** that you lose (default **20**). Always use `cancellationPreview` on the confirm dialog — do not hardcode 80/20 if the listing differs.
- Confirm copy:

> Cancel this booking? You get **{refundAmount} RWF** back. **{penaltyAmount} RWF** ({penaltyPercent}%) is kept as a cancellation fee. The refund returns to the Mobile Money / method you paid with and can take a short time.

- If the window has closed, the API returns 409. Hide Cancel. The booking stays valid; the guest is not refunded; the provider will receive their share.

**What happens to the money**

| Situation | Guest | What we say on the site |
|---|---|---|
| Paid, no cancel | Visits with booking code | After the cancel deadline, SafarisCon pays the provider their share. Platform service fee stays in the SafarisCon wallet. |
| Cancel in time | Refund = paid − cancellation fee | Fee is kept. Refund is sent back through the payment provider. |
| Cancel too late | No refund | Booking remains usable at the venue. |

Do **not** tell guests the platform/provider split of the fee (that is internal). Providers see their share on `/api/hotel/finance`.

**Refund timing**

- Refunds are not instant cash in the app. They go through the same payment partner (XentriPay) to the guest’s MoMo / original method. Admin may need to confirm the payout. UI copy: “Refunds usually arrive after a short processing time.”

**At the venue**

- The provider verifies the booking code. Completing the booking does **not** charge anything extra.

**Chargebacks / failed pay**

- If MoMo or card fails, the guest may retry. No details unlock until payment succeeds.
- Disputes: contact support with the booking code. Do not promise an automatic chargeback reversal in the UI.

---

### 14.7 Terms of use (for `/terms`) — guest + provider

Keep this readable. Split “For guests” and “For providers”.

**For guests**

- You must be able to enter a valid email and complete OTP verification.
- You are responsible for the accuracy of booking dates, times, guest counts, and the location fields you submit.
- A booking is a contract to pay the displayed full price. Promotions apply only if the listing still has them when you book.
- Provider identity is hidden until you pay. Using the app to harvest contacts before payment is not allowed.
- After payment you receive a booking code. Bring it (or the QR / receipt) to the venue.
- Cancellation is only inside the window on that booking. After that, no refund through this cancel button.
- SafarisCon is the marketplace and payment holder. The stay / activity is performed by the listed provider.

**For providers**

- Listings go public after SafarisCon approval. Admin sets your commission; guests never see that number.
- You must save MoMo or bank payout details before customers can pay you.
- You may set cancel window hours and cancel penalty % on the listing (defaults 6 hours / 20%).
- Guest money is held until the cancel window ends (or the guest cancels in time). You are not paid the moment they pay.
- If the guest cancels in time, you receive your share of the **cancellation fee**, not the full booking.
- If they do not cancel, you receive your share of the **full** booking after the window, once SafarisCon confirms the payout.
- Completing a booking means verifying the code only — do not collect a second cash amount for the old “70% remainder”.
- Do not put payout account numbers on the public service form.

**Platform**

- We may refuse or suspend accounts that abuse OTP, payments, or listings.
- Catalog methods and banks come from `GET /api/payments/methods` — do not hardcode a single telco.
- These terms describe the current product. Commission, default cancel window, and default penalty can differ per listing / business.

---

### 14.8 Ready-made home-page blurb (one block)

Use this if you need a single `<section>` on the home page without extra routes yet. Still add footer links when you can.

```text
Trust & how we work

SafarisCon is built so guests can book without exposing hotels too early, and so money is not sent to a provider before the guest’s cancel window ends.

Accounts. Create an account with your name, email, and password. We verify your email with a one-time code. Every login also requires a code we send to your email. Passwords are stored hashed. You can sign out at any time.

Your data. We use your details to run your account, bookings, receipts, and payments. Public pages do not show the provider’s phone or exact address until you pay. We do not sell your data. Payments are processed by our payment partner; we do not ask for your MoMo PIN or card PIN. Product analytics store a hashed identifier, not your raw IP.

Bookings. Browse anonymized listings, request a date and time, then pay the full price in the app (Mobile Money or card). Payment lands in the SafarisCon wallet. When it succeeds, you get the real provider details and a booking code to show at the venue. There is no extra payment on arrival.

Cancellations & refunds. Each listing shows how many hours before the service you may cancel, and what percent of your payment is kept as a fee (commonly 6 hours and 20%). Cancel in time and the rest is refunded to you. After the deadline the booking stays valid and is no longer refundable through the app. Unpaid requests have nothing to refund.

Read the full Terms, Privacy policy, and Payments & refunds.
```

---

### 14.9 Checklist for the frontend engineer

- [ ] Home page has a visible “How SafarisCon works” section (not only a footer link).
- [ ] Footer links: Terms, Privacy, Payments & cancellations.
- [ ] Register mentions Terms + Privacy.
- [ ] Pay screen says full amount, wallet hold, not “hotel paid instantly”.
- [ ] Cancel dialog uses `cancellationPreview` and does not show commission splits.
- [ ] Listing cards / detail use that listing’s `cancellationTerms` for hours and fee.
- [ ] No leftover copy about 30% deposit or 70% at the venue.
- [ ] Support contact is on the privacy / terms pages.
- [ ] Guest pages never render `platformAmount`, `providerAmount`, or admin settlement UI.
