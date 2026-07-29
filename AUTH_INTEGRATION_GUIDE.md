# Auth OTP Integration Guide

This backend keeps the existing login and registration flow working, then adds email verification and forgot/reset password flows on top.

## What changed

- `POST /api/auth/register` still creates a customer and still returns `{ user, token }`.
- New customer accounts now start with `user.emailVerified === false`.
- Registration automatically sends an email verification OTP.
- Login blocks any unverified account with `403 EMAIL_NOT_VERIFIED`.
- Password reset uses a separate OTP from email verification.
- OTPs are stored hashed in MongoDB and expire by default after 10 minutes.
- Provider onboarding completion marks the provider email as verified.

## Auth payload

All auth user payloads now include:

```json
{
  "emailVerified": false
}
```

Use this field to decide whether the user can continue after registration or email verification.

## Customer registration

```http
POST /api/auth/register
Content-Type: application/json
```

Request:

```json
{
  "name": "Jane Customer",
  "email": "jane@example.com",
  "password": "Password123!",
  "role": "customer"
}
```

Success response:

```json
{
  "user": {
    "id": "...",
    "email": "jane@example.com",
    "name": "Jane Customer",
    "role": "customer",
    "emailVerified": false
  },
  "token": "...",
  "emailVerification": {
    "required": true,
    "sent": true,
    "expiresInMinutes": 10
  }
}
```

Frontend behavior:

- You may store the token temporarily, but do not treat the user as fully logged in until email verification succeeds.
- Show the OTP screen immediately when `user.emailVerified` is false.
- After OTP verification, replace the stored user and token with the response from `/api/auth/email/verify-otp`.

## Login

```http
POST /api/auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "jane@example.com",
  "password": "Password123!"
}
```

Success:

```json
{
  "user": {
    "id": "...",
    "email": "jane@example.com",
    "name": "Jane Customer",
    "role": "customer",
    "emailVerified": true
  },
  "token": "..."
}
```

Unverified account response:

```json
{
  "code": "EMAIL_NOT_VERIFIED",
  "message": "Please verify your email before logging in.",
  "email": "jane@example.com",
  "emailVerified": false
}
```

Status: `403`

Frontend behavior:

- If login returns `403` with `code === "EMAIL_NOT_VERIFIED"`, send the user to the email OTP screen.
- Call `/api/auth/email/resend-verification-otp` if the user needs a fresh code.
- After `/api/auth/email/verify-otp` succeeds, store the returned `user` and `token`.
- Wrong email/password still returns `401 Invalid credentials.`

## Resend email verification OTP

```http
POST /api/auth/email/resend-verification-otp
Content-Type: application/json
```

Request:

```json
{
  "email": "jane@example.com"
}
```

Success:

```json
{
  "message": "Verification code sent.",
  "expiresInMinutes": 10
}
```

Already verified:

```json
{
  "message": "Email is already verified.",
  "emailVerified": true
}
```

Too soon:

```json
{
  "message": "Please wait 60 seconds before requesting another code."
}
```

Status: `429`

## Verify email OTP

```http
POST /api/auth/email/verify-otp
Content-Type: application/json
```

Request:

```json
{
  "email": "jane@example.com",
  "otp": "123456"
}
```

Success:

```json
{
  "message": "Email verified successfully.",
  "user": {
    "id": "...",
    "email": "jane@example.com",
    "name": "Jane Customer",
    "role": "customer",
    "emailVerified": true
  },
  "token": "..."
}
```

Frontend behavior:

- Replace the stored user with the returned `user`.
- Replace the stored token with the returned `token`.
- Move the user out of the OTP screen.

Common errors:

- `400 Invalid OTP.`
- `400 OTP has expired. Request a new code.`
- `429 Too many incorrect OTP attempts. Request a new code.`

## Forgot password

```http
POST /api/auth/forgot-password
Content-Type: application/json
```

Request:

```json
{
  "email": "jane@example.com"
}
```

Success:

```json
{
  "message": "If this email is registered, a password reset code has been sent.",
  "expiresInMinutes": 10
}
```

Frontend behavior:

- Always show the next OTP/password screen on `200`.
- Do not reveal whether the email exists.

## Reset password

```http
POST /api/auth/reset-password
Content-Type: application/json
```

Request:

```json
{
  "email": "jane@example.com",
  "otp": "654321",
  "newPassword": "NewPassword123!"
}
```

Success:

```json
{
  "message": "Password reset successfully. You can now login with the new password."
}
```

Frontend behavior:

- Send the user to the login screen.
- Ask them to login with the new password.

## Email delivery

Auth emails are sent through SMTP using these `.env` variables:

```env
MAILER_HOST=smtp.example.com
MAILER_PORT=587
MAILER_PRODUCER_EMAIL=no-reply@example.com
MAILER_PRODUCER_PASSWORD=your_smtp_password
MAILER_REJECT_UNAUTHORIZED=true
```

Notes:

- `MAILER_PORT=465` uses secure SMTP automatically.
- Other ports, like `587`, use STARTTLS when the SMTP server supports it.
- `MAILER_REJECT_UNAUTHORIZED=false` allows self-signed or untrusted certificates. Use `true` in production whenever possible.
- If any required mailer value is missing, the backend falls back to console simulation so local development does not break.

The same mailer sends:

- email verification OTPs
- password reset OTPs
- provider onboarding emails

No frontend route changes are needed when SMTP settings change.

## Optional environment variables

```env
AUTH_OTP_EXPIRY_MINUTES=10
AUTH_OTP_RESEND_COOLDOWN_SECONDS=60
AUTH_OTP_MAX_ATTEMPTS=5
```

## Compatibility notes

- `/api/auth/login` now blocks any unverified account.
- Existing `/api/auth/register` still returns token immediately.
- Provider onboarding still works.
- Admin-created provider login is still blocked until `mustSetPassword` is false.
- Completing provider onboarding marks that provider as verified, so they can login immediately afterward.
- Email verification blocks login for every role.
