const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  // Singleton pattern - only one settings document
  _id: { type: String, default: 'system' },

  // Promotional discount percentage (0-100)
  promotionalDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },

  // Metadata
  updatedAt: { type: Date, default: Date.now },
  updatedBy: String  // Email of admin who last updated
});

// Update timestamp on save
systemSettingsSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
