const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  phoneVerified: { type: Boolean, default: false },
  passwordHash: String,
  role: { type: String, enum: ['customer', 'venue', 'admin'], default: 'customer' },
  venueId: mongoose.Schema.Types.ObjectId,
  totalSpent: { type: Number, default: 0 },
  passesUsed: { type: Number, default: 0 },
  favoriteVenues: [mongoose.Schema.Types.ObjectId],
  wantsPromotions: { type: Boolean, default: false },  // Opt-in for promotional discounts
  smsOptIn: { type: Boolean, default: true },  // Opt-in for SMS updates from venues (default true for new purchases)

  // Host email rate limiting
  hostEmailsToday: { type: Number, default: 0 },
  hostEmailsLastReset: { type: Date, default: Date.now },

  // Host display settings
  hostDisplayName: { type: String },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
