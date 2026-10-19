<p align="center">
  <img src="https://img.shields.io/badge/node-18+-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/stripe-connect-blueviolet" alt="Stripe">
  <img src="https://img.shields.io/badge/realtime-socket.io-black" alt="Socket.IO">
</p>

<h1 align="center">⚡ Lightning Pass</h1>

<p align="center">
  <strong>Open-source event ticketing API with Stripe Connect revenue splits, real-time queues, and QR pass validation.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#api">API</a> •
  <a href="#dj-requests">DJ Requests</a>
</p>

---

## Why Lightning Pass?

Ticketmaster takes 25%+. Eventbrite charges per ticket. Lightning Pass lets venues keep **85%** of every sale with automatic Stripe Connect splits.

| | Lightning Pass | Ticketmaster | Eventbrite |
|---|:---:|:---:|:---:|
| Venue keeps | 85% | ~60% | ~90% |
| Real-time queue | ✅ | ❌ | ❌ |
| DJ requests | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ❌ | ❌ |
| Open source | ✅ | ❌ | ❌ |

---

## Features

### 🎫 Ticketing
- **Pass Templates**: Create reusable ticket types
- **QR Validation**: Scan at door, instant verification
- **Capacity Limits**: Auto-cutoff when sold out
- **Refund Handling**: One-click refund processing

### 💳 Stripe Connect
- **85/15 Split**: Venue gets 85%, platform gets 15%
- **Instant Payouts**: Direct to venue bank account
- **Multi-venue**: Each venue has their own Connect account

### 🎧 DJ Request System
Skip-the-queue payments for song requests:

| Tier | Price | What It Does |
|------|-------|--------------|
| Next 5 | $3 | Play in next 5 songs |
| Next Up | $10 | Play next |
| Play Now | $25 | Interrupt current song |

Revenue split: DJ gets 80% of base, 40% of bolt fees, 100% of tips.

### 📡 Real-Time
- **Socket.IO**: Live queue updates
- **Broadcast Messages**: Push to all attendees
- **Queue Position**: Customers see their place in line

---

## Quick Start

```bash
# Clone
git clone https://github.com/PheonixOfTesla/lightning-pass.git
cd lightning-pass

# Install
npm install

# Configure
cp .env.example .env
# Add MongoDB URI, Stripe keys

# Seed sample venues
node seedVenues.js

# Run
npm start
```

### Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017/lightning
JWT_SECRET=your-secret
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
```

---

## API

### Create Pass
```bash
curl -X POST /api/v1/lightning/passes \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "venueId": "...",
    "templateId": "...",
    "customerEmail": "fan@email.com"
  }'
```

### Validate Pass (Door Scanner)
```bash
curl -X POST /api/v1/lightning/validate \
  -d '{"qrCode": "PASS-ABC123"}'
```

### DJ Request
```bash
curl -X POST /api/v1/dj-requests \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sessionId": "...",
    "songTitle": "Sandstorm",
    "artist": "Darude",
    "boltTier": "play_now",
    "tipAmount": 500
  }'
```

---

## Models

| Model | Purpose |
|-------|---------|
| `Venue` | Venue info, Stripe Connect ID |
| `PassTemplate` | Ticket types, pricing |
| `Pass` | Individual tickets |
| `Transaction` | Payment records |
| `Queue` | Real-time queue state |
| `DJRequest` | Song requests with payments |

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express
- **Database**: MongoDB
- **Payments**: Stripe Connect
- **Real-time**: Socket.IO
- **SMS**: Twilio
- **QR**: qrcode library

---

## License

MIT License

---

<p align="center">
  <strong>Your event. Your revenue. Your data.</strong>
</p>
