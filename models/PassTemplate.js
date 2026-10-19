const mongoose = require('mongoose');

const passTemplateSchema = new mongoose.Schema({
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
  venueName: { type: String, required: true },

  // Pass Details
  name: { type: String, required: true },  // e.g., "VIP Unlimited Drinks"
  description: { type: String },  // e.g., "Full open bar access all night"
  price: { type: Number, required: true, min: 5, max: 500 },

  // Customization
  tagline: { type: String },  // e.g., "DJ ESCO at 9pm - Enjoy the night!"
  features: [String],  // e.g., ["Unlimited drinks", "Skip the line", "VIP section"]

  // Availability
  isActive: { type: Boolean, default: true },
  maxQuantityPerPurchase: { type: Number, default: 10 },

  // Metadata
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
passTemplateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for common queries
passTemplateSchema.index({ venueId: 1, isActive: 1 });
passTemplateSchema.index({ venueId: 1, createdAt: -1 });

module.exports = mongoose.model('PassTemplate', passTemplateSchema);
