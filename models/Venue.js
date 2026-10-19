const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: 'Nightclub' },
  address: { type: String, required: true },
  coordinates: {
    lat: { type: Number, default: 27.3364 },
    lng: { type: Number, default: -82.5307 }
  },
  capacity: { type: Number, default: 500 },
  currentPrice: { type: Number, default: 35 },
  basePrice: { type: Number, default: 25 },
  availablePasses: { type: Number, default: 50 },
  isActive: { type: Boolean, default: true },
  waitTime: { type: Number, default: 45 },
  inLine: { type: Number, default: 0 },
  tonightTagline: { type: String, default: '' },
  status: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  trending: { type: Boolean, default: false },
  ownerId: mongoose.Schema.Types.ObjectId,
  
  // NEW FIELDS FOR APPROVAL SYSTEM
  approvalStatus: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  ownerEmail: { type: String },
  ownerPhone: { type: String },
  ownerName: { type: String },
  appliedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date },
  approvedBy: { type: String }, // Admin username who approved
  rejectedAt: { type: Date },
  rejectionReason: { type: String },

  // STRIPE CONNECT & PAYOUT FIELDS
  stripeConnectId: String,
  lifetimeRevenue: { type: Number, default: 0 },  // Total revenue earned (for reporting only - money auto-sent via destination charges)
  pendingPayout: { type: Number, default: 0 },  // DEPRECATED: kept for backward compatibility
  totalPaidOut: { type: Number, default: 0 },  // Track total paid out via Stripe Connect
  lastPayoutAt: Date,
  bankAccountLast4: String,
  payoutSchedule: { type: String, enum: ['daily', 'end_of_night'], default: 'end_of_night' },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Venue', venueSchema);
