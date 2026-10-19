const express = require('express');
const router = express.Router();
const Venue = require('../models/Venue');
const Pass = require('../models/Pass');
const PassTemplate = require('../models/PassTemplate');
const Transaction = require('../models/Transaction');
const LightningSauce = require('../core/Lightning-Sauce');
const stripe = require('../integrations/stripe');
const twilio = require('../integrations/twilio');
const QRCode = require('../utils/qrCode');
const mongoose = require('mongoose');
const { verifyToken, requireRole, requireVenueOwnership } = require('../middleware/auth');

// Helper function to sanitize error messages (remove API keys)
function sanitizeError(errorMessage) {
  if (!errorMessage) return 'An error occurred';
  // Remove any string that looks like an API key (sk_test_, pk_test_, sk_live_, pk_live_)
  return errorMessage
    .replace(/sk_test_[a-zA-Z0-9]+/g, 'sk_test_***')
    .replace(/pk_test_[a-zA-Z0-9]+/g, 'pk_test_***')
    .replace(/sk_live_[a-zA-Z0-9]+/g, 'sk_live_***')
    .replace(/pk_live_[a-zA-Z0-9]+/g, 'pk_live_***')
    .replace(/whsec_[a-zA-Z0-9]+/g, 'whsec_***');
}

// ==================== PUBLIC ROUTES (No auth required) ====================

// GET config - Returns public configuration (Stripe publishable key)
router.get('/config', async (req, res) => {
  try {
    res.json({
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim()
    });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET all venues - REAL DATABASE (with approval filtering)
router.get('/venues', async (req, res) => {
  try {
    const { approvalStatus, includeAll } = req.query;
    
    let filter = {};
    
    // For admin panel, include all venues
    if (includeAll === 'true') {
      // No filter, return everything
    }
    // For customer app, only show approved and active venues
    else {
      filter = { 
        isActive: true,
        $or: [
          { approvalStatus: 'approved' },
          { approvalStatus: { $exists: false } } // Legacy venues without approval status
        ]
      };
    }
    
    // Allow filtering by specific approval status
    if (approvalStatus) {
      filter.approvalStatus = approvalStatus;
    }
    
    const venues = await Venue.find(filter).lean();
    res.json({ venues });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== PROTECTED ROUTES (Auth required) ====================

// GET venues by owner - Returns all venues owned by authenticated user
// IMPORTANT: This route must come BEFORE /venues/:id to avoid route collision
router.get('/venues/by-owner', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const venues = await Venue.find({ ownerId: req.userId }).sort({ createdAt: -1 });

    console.log(`📋 Loaded ${venues.length} venues for owner ${req.userEmail}`);

    res.json({
      success: true,
      venues
    });

  } catch (error) {
    console.error('Error loading owner venues:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET single venue - REAL DATABASE
router.get('/venues/:id', async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    res.json({ venue });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST create new venue - REAL DATABASE (REQUIRES AUTH)
router.post('/venues/create', verifyToken, async (req, res) => {
  try {
    const venueData = req.body;

    // CRITICAL: Always set owner to current user
    // This is the security scoping key - never accept ownerId from client
    venueData.ownerId = req.userId;
    venueData.ownerEmail = req.userEmail;  // Also set email for reference

    // New venues start as pending
    if (!venueData.approvalStatus) {
      venueData.approvalStatus = 'pending';
    }

    // Create new venue
    const newVenue = new Venue(venueData);

    // Defensive check: log if ownerId somehow not set (should never happen)
    if (!newVenue.ownerId) {
      console.error(`🚨 CRITICAL: Venue created without ownerId! Name: ${newVenue.name}, User: ${req.userEmail}`);
    }

    await newVenue.save();

    // Update the user's venueId only if they don't have one yet (first venue)
    const User = require('../models/User');
    const user = await User.findById(req.userId);

    if (!user.venueId) {
      await User.findByIdAndUpdate(req.userId, {
        venueId: newVenue._id,
        role: 'venue'  // Ensure they have venue role
      });
      console.log(`✅ User ${req.userEmail} linked to first venue ${newVenue._id}`);
    } else {
      console.log(`✅ Additional venue created for ${req.userEmail} (Total venues: ${await Venue.countDocuments({ ownerId: req.userId })})`);
    }

    console.log(`✅ New venue created: ${newVenue.name} (Status: ${newVenue.approvalStatus || 'pending'}) by ${req.userEmail}`);
    
    res.json({ 
      success: true, 
      message: newVenue.approvalStatus === 'pending' 
        ? 'Venue application submitted for review' 
        : 'Venue created successfully',
      venue: newVenue,
      // Return updated venueId so frontend can use it
      venueId: newVenue._id.toString()
    });
    
  } catch (error) {
    console.error('Error creating venue:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST approve/reject venue - ADMIN ONLY
router.post('/venue/approve', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { venueId, approvalStatus, rejectionReason } = req.body;
    
    if (!['approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.approvalStatus = approvalStatus;
    
   if (approvalStatus === 'approved') {
  venue.approvedAt = new Date();
  venue.approvedBy = req.userEmail || 'admin';
  venue.isActive = true; // Activate venue so it shows up for venue owners

  console.log(`✅ Venue APPROVED: ${venue.name} by ${req.userEmail}`);
  
  // Link the venue to its owner's user account
  if (venue.ownerId) {
    const User = require('../models/User');
    await User.findByIdAndUpdate(venue.ownerId, {
      venueId: venue._id,
      role: 'venue'
    });
    console.log(`✅ User ${venue.ownerId} linked to approved venue ${venue._id}`);
  }
  
  // TODO: Send approval email to venue owner with login credentials
  // await sendApprovalEmail(venue);
  
} else if (approvalStatus === 'rejected') {
  venue.rejectedAt = new Date();
  venue.rejectionReason = rejectionReason || 'Application did not meet requirements';
  
  console.log(`❌ Venue REJECTED: ${venue.name} by ${req.userEmail}`);
      
      // TODO: Send rejection email to venue owner
      // await sendRejectionEmail(venue);
    }
    
    await venue.save();

    // 🔥 Real-time WebSocket notification
    if (global.io && approvalStatus === 'approved') {
      // Notify the venue owner's dashboard
      global.io.emit('venueApproved', {
        venueId: venue._id,
        venueName: venue.name,
        ownerId: venue.ownerId,
        approvedAt: venue.approvedAt
      });

      console.log(`🔥 WebSocket: Emitted venueApproved for ${venue.name}`);
    }

    res.json({
      success: true,
      message: `Venue ${approvalStatus}`,
      venue
    });
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// DELETE venue - ADMIN ONLY
router.delete('/venues/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Optional: Check if venue has active passes before deleting
    const activePasses = await Pass.countDocuments({ 
      venueId: req.params.id, 
      status: 'active' 
    });
    
    if (activePasses > 0) {
      return res.status(400).json({ 
        error: `Cannot delete venue with ${activePasses} active passes. Please wait for passes to expire or contact support.`,
        activePasses 
      });
    }
    
    await Venue.findByIdAndDelete(req.params.id);
    
    console.log(`🗑️ Venue DELETED: ${venue.name} by ${req.userEmail}`);
    
    res.json({ 
      success: true, 
      message: 'Venue deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== BROADCAST MESSAGING ====================

// POST send broadcast message to pass holders - VENUE OWNER ONLY
router.post('/venue/:venueId/broadcast', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { message, targetAudience = 'all_customers' } = req.body;
    const venueId = req.params.venueId;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Get all unique customers who bought passes from this venue
    let passFilter = { venueId: venueId };

    // Apply targeting filters
    if (targetAudience === 'active_pass_holders') {
      passFilter.status = 'active';
      passFilter.validUntil = { $gte: new Date() };
    } else if (targetAudience === 'recent_customers') {
      // Last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      passFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    // Get unique customers (dedupe by phone number)
    const passes = await Pass.find(passFilter).select('phone email').lean();

    // Deduplicate by phone number and filter for SMS opt-in
    const uniquePhones = new Map();
    for (const pass of passes) {
      if (pass.phone && !uniquePhones.has(pass.phone)) {
        uniquePhones.set(pass.phone, { phone: pass.phone, email: pass.email });
      }
    }

    // Check SMS opt-in status for each user
    const User = require('../models/User');
    const recipients = [];

    for (const [phone, data] of uniquePhones) {
      const user = await User.findOne({ phone: phone });
      // Include if user opted in OR if user doesn't exist in User table (legacy customer)
      if (!user || user.smsOptIn !== false) {
        recipients.push(data);
      }
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No eligible recipients found' });
    }

    // Calculate cost
    const { calculateSMSSegments } = require('../integrations/twilio');
    const segments = calculateSMSSegments(message + `\n\n- ${venue.name}`);
    const costPerMessage = 0.0075; // Twilio US pricing
    const totalCost = recipients.length * segments * costPerMessage;

    // Create broadcast record
    const BroadcastMessage = require('../models/BroadcastMessage');
    const broadcast = new BroadcastMessage({
      venueId: venueId,
      venueName: venue.name,
      sentBy: req.userEmail,
      message: message,
      totalRecipients: recipients.length,
      estimatedCost: totalCost,
      messageSegments: segments,
      targetAudience: targetAudience,
      status: 'sending'
    });

    await broadcast.save();

    // Send messages asynchronously
    const { sendBroadcastMessage } = require('../integrations/twilio');
    const results = [];

    for (const recipient of recipients) {
      const result = await sendBroadcastMessage(recipient.phone, message, venue.name);

      results.push({
        phone: recipient.phone,
        email: recipient.email,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error || undefined,
        twilioMessageSid: result.messageSid || undefined
      });

      if (result.success) {
        broadcast.successfulSends += 1;
      } else {
        broadcast.failedSends += 1;
      }
    }

    // Update broadcast with results
    broadcast.recipients = results;
    broadcast.status = 'completed';
    broadcast.sentAt = new Date();
    broadcast.completedAt = new Date();
    await broadcast.save();

    console.log(`📢 Broadcast sent by ${venue.name}: ${broadcast.successfulSends}/${recipients.length} successful`);

    res.json({
      success: true,
      broadcast: {
        id: broadcast._id,
        totalRecipients: broadcast.totalRecipients,
        successfulSends: broadcast.successfulSends,
        failedSends: broadcast.failedSends,
        estimatedCost: broadcast.estimatedCost,
        messageSegments: segments
      }
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET broadcast history for venue - VENUE OWNER ONLY
router.get('/venue/:venueId/broadcasts', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venueId = req.params.venueId;
    const BroadcastMessage = require('../models/BroadcastMessage');

    const broadcasts = await BroadcastMessage.find({ venueId: venueId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-recipients') // Don't send full recipient list
      .lean();

    res.json({ success: true, broadcasts });

  } catch (error) {
    console.error('Broadcast history error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET recipient count estimate - VENUE OWNER ONLY
router.get('/venue/:venueId/broadcast/estimate', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venueId = req.params.venueId;
    const { targetAudience = 'all_customers', message = '' } = req.query;

    let passFilter = { venueId: venueId };

    if (targetAudience === 'active_pass_holders') {
      passFilter.status = 'active';
      passFilter.validUntil = { $gte: new Date() };
    } else if (targetAudience === 'recent_customers') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      passFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    const passes = await Pass.find(passFilter).select('phone').lean();
    const uniquePhones = new Set(passes.map(p => p.phone).filter(Boolean));

    // Check SMS opt-in
    const User = require('../models/User');
    let optedInCount = 0;
    for (const phone of uniquePhones) {
      const user = await User.findOne({ phone: phone });
      if (!user || user.smsOptIn !== false) {
        optedInCount++;
      }
    }

    // Calculate cost
    const { calculateSMSSegments } = require('../integrations/twilio');
    const venue = await Venue.findById(venueId);
    const segments = message ? calculateSMSSegments(message + `\n\n- ${venue.name}`) : 1;
    const costPerMessage = 0.0075;
    const estimatedCost = optedInCount * segments * costPerMessage;

    res.json({
      success: true,
      estimate: {
        totalCustomers: uniquePhones.size,
        optedInCustomers: optedInCount,
        messageSegments: segments,
        costPerRecipient: (costPerMessage * segments).toFixed(4),
        estimatedCost: estimatedCost.toFixed(2)
      }
    });

  } catch (error) {
    console.error('Estimate error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== FIXED PAYMENT FLOW ====================

// STEP 1: Create payment intent (DON'T create pass yet!)
router.post('/passes/create-payment', async (req, res) => {
  try {
    const { venueId, email, phone, numPasses, templateId } = req.body;

    // Validate input
    if (!venueId || !email || !phone || !numPasses) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (numPasses < 1 || numPasses > 10) {
      return res.status(400).json({ error: 'Invalid number of passes (1-10)' });
    }

    // Get venue
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Check venue is approved and active
    if (venue.approvalStatus && venue.approvalStatus !== 'approved') {
      return res.status(400).json({ error: 'Venue is not accepting passes at this time' });
    }

    if (!venue.isActive) {
      return res.status(400).json({ error: 'Venue passes not active' });
    }

    // REQUIRE STRIPE CONNECT BEFORE ALLOWING PURCHASES
    if (!venue.stripeConnectId) {
      return res.status(403).json({
        error: 'This venue has not connected their bank account yet. Passes cannot be purchased at this time.',
        code: 'VENUE_BANK_NOT_CONNECTED'
      });
    }

    // Check availability
    if (venue.availablePasses < numPasses) {
      return res.status(400).json({ error: 'Not enough passes available' });
    }

    // Get pass template if provided, otherwise use venue's current price
    let price = venue.currentPrice;
    let passName = 'General Admission';
    let passDescription = '';
    let tagline = '';

    if (templateId) {
      const template = await PassTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({ error: 'Pass template not found' });
      }
      if (!template.isActive) {
        return res.status(400).json({ error: 'This pass type is not available' });
      }
      price = template.price;
      passName = template.name;
      passDescription = template.description || '';
      tagline = template.tagline || '';
    }

    // Check for promotional discount
    let discountPercent = 0;
    let originalAmount = price * numPasses;
    let amount = originalAmount;

    const User = require('../models/User');
    const user = await User.findOne({ email: email.toLowerCase() });

    if (user && user.wantsPromotions) {
      // Get system settings for promotional discount
      const SystemSettings = require('../models/SystemSettings');
      const settings = await SystemSettings.findById('system');

      if (settings && settings.promotionalDiscountPercent > 0) {
        discountPercent = settings.promotionalDiscountPercent;
        const discountAmount = originalAmount * (discountPercent / 100);
        amount = originalAmount - discountAmount;
        console.log(`🎁 Promotional discount applied: ${discountPercent}% off ($${originalAmount.toFixed(2)} → $${amount.toFixed(2)}) for ${email}`);
      }
    }

    const amountCents = Math.round(amount * 100);

    // Create payment intent with automatic split if venue has Stripe Connect
    const paymentIntent = await stripe.createPaymentIntent(
      amountCents,
      email,
      venue.stripeConnectId  // Automatically splits 85% to venue, 15% to platform
    );

    // Store payment intent metadata for later
    await stripe.updatePaymentIntent(paymentIntent.id, {
      metadata: {
        venueId: venue._id.toString(),
        venueName: venue.name,
        email,
        phone,
        numPasses: numPasses.toString(),
        amount: amount.toString(),
        originalAmount: originalAmount.toString(),
        discountPercent: discountPercent.toString(),
        templateId: templateId || '',
        passName,
        passDescription,
        tagline
      }
    });

    console.log(`💳 Payment intent created: ${paymentIntent.id} for ${venue.name} - ${passName} x${numPasses}`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// STEP 2: After payment succeeds, create the pass
router.post('/passes/confirm-payment', async (req, res) => {
  try {
    const { paymentIntentId, email, phone } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }
    
    // Retrieve payment intent from Stripe
    let paymentIntent = await stripe.retrievePaymentIntent(paymentIntentId);

    // For test mode: auto-confirm payment intents that need confirmation
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_confirmation') {
      try {
        // Auto-confirm with test payment method in test mode
        paymentIntent = await stripe.confirmPaymentIntent(paymentIntentId, 'pm_card_visa');
        console.log(`💳 Test payment auto-confirmed: ${paymentIntentId}`);
      } catch (confirmError) {
        console.error('Auto-confirm failed:', confirmError.message);
      }
    }

    // Verify payment succeeded
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: 'Payment not completed',
        status: paymentIntent.status,
        hint: 'Payment requires confirmation with a valid payment method'
      });
    }
    
    // Check if pass already created (idempotency)
    const existingPass = await Pass.findOne({ 
      stripePaymentIntentId: paymentIntentId 
    });
    
    if (existingPass) {
      console.log(`✅ Pass already exists: ${existingPass.passId}`);
      return res.json({
        success: true,
        passId: existingPass.passId,
        pass: existingPass,
        message: 'Pass already created'
      });
    }
    
    // Get metadata
    const {
      venueId,
      venueName,
      numPasses,
      amount,
      templateId,
      passName,
      passDescription,
      tagline
    } = paymentIntent.metadata;

    // Get venue
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Generate pass with unique ID
    const passId = `LP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const qrCodeData = await QRCode.generate(passId);

    // Create pass with template information
    const newPass = new Pass({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      purchasePrice: parseFloat(amount) / parseInt(numPasses),
      quantity: parseInt(numPasses),
      amount: parseFloat(amount),
      qrCode: qrCodeData,
      status: 'active',
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      stripePaymentIntentId: paymentIntentId,
      // Template information
      templateId: templateId || null,
      passName: passName || 'General Admission',
      passDescription: passDescription || '',
      tagline: tagline || ''
    });
    
    await newPass.save();
    
    // Create transaction
    const transaction = new Transaction({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email,
      phone,
      amount: parseFloat(amount),
      venueRevenue: parseFloat(amount) * 0.85,
      platformFee: parseFloat(amount) * 0.15,
      stripeChargeId: paymentIntentId,
      status: 'completed'
    });
    
    await transaction.save();
    
    // Update venue and track lifetime revenue
    venue.availablePasses -= parseInt(numPasses);
    venue.inLine += parseInt(numPasses);
    venue.lifetimeRevenue = (venue.lifetimeRevenue || 0) + (parseFloat(amount) * 0.85); // Track 85% for reporting (money auto-sent via Stripe destination charges)
    await venue.save();

    console.log(`✅ Pass created after payment: ${passId} for ${venue.name}`);

    // 🔥 Real-time WebSocket notification to venue dashboard
    if (global.io) {
      global.io.to(`venue:${venue._id}`).emit('passPurchased', {
        passId,
        venueId: venue._id,
        venueName: venue.name,
        quantity: parseInt(numPasses),
        amount: parseFloat(amount),
        revenue: parseFloat(amount) * 0.85,
        lifetimeRevenue: venue.lifetimeRevenue,
        inLine: venue.inLine,
        purchasedAt: new Date()
      });
      console.log(`🔥 WebSocket: Emitted passPurchased for ${venue.name}`);
    }
    
    // Send confirmation SMS
    try {
      await twilio.sendPassConfirmation(phone, venue, newPass);
    } catch (smsError) {
      console.error('SMS send failed:', smsError);
      // Don't fail the request if SMS fails
    }
    
    res.json({
      success: true,
      passId,
      pass: newPass
    });
    
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Stripe Webhook Handler
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ Payment succeeded:', paymentIntent.id);
      
      // Pass is created via confirm-payment endpoint
      // This is just for logging/monitoring
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ Payment failed:', failedPayment.id);
      
      // Could send notification to customer
      break;
      
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// ==================== PUBLIC PASS ROUTES ====================

// GET pass QR code - PUBLIC (for MMS and web viewing)
router.get('/passes/:passId/qr', async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });

    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    // Return QR code as base64 data URL
    res.json({
      qrCode: pass.qrCode,
      passId: pass.passId,
      venueName: pass.venueName,
      status: pass.status,
      validUntil: pass.validUntil
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET pass QR code image - PUBLIC (direct image for MMS)
router.get('/passes/:passId/qr-image', async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });

    if (!pass) {
      return res.status(404).send('Pass not found');
    }

    // Convert data URL to buffer and send as PNG
    const base64Data = pass.qrCode.replace(/^data:image\/png;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(imgBuffer);

  } catch (error) {
    res.status(500).send('Error generating QR code');
  }
});

// PUT edit pass - VENUE/ADMIN ONLY
router.put('/passes/:passId/edit', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const { passId } = req.params;
    const { validUntil, status, quantity, passName, passDescription, notes } = req.body;

    // Find the pass
    const pass = await Pass.findOne({ passId });

    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    // Verify venue ownership (unless admin)
    if (req.userRole !== 'admin') {
      const venue = await Venue.findById(pass.venueId);
      if (!venue || venue.ownerId.toString() !== req.userId) {
        return res.status(403).json({ error: 'Not authorized to edit this pass' });
      }
    }

    // Update allowed fields
    if (validUntil) {
      pass.validUntil = new Date(validUntil);
    }

    if (status && ['active', 'used', 'expired', 'refunded'].includes(status)) {
      pass.status = status;
    }

    if (quantity && quantity > 0) {
      pass.quantity = parseInt(quantity);
    }

    if (passName) {
      pass.passName = passName;
    }

    if (passDescription !== undefined) {
      pass.passDescription = passDescription;
    }

    if (notes !== undefined) {
      pass.notes = notes;
    }

    pass.lastModified = new Date();

    await pass.save();

    console.log(`✏️ Pass edited: ${passId} by ${req.userEmail}`);

    // 🔥 Real-time WebSocket notification
    if (global.io) {
      global.io.to(`venue:${pass.venueId}`).emit('passUpdated', {
        passId: pass.passId,
        venueId: pass.venueId,
        status: pass.status,
        validUntil: pass.validUntil,
        updatedAt: new Date()
      });
      console.log(`🔥 WebSocket: Emitted passUpdated for ${passId}`);
    }

    res.json({
      success: true,
      message: 'Pass updated successfully',
      pass
    });

  } catch (error) {
    console.error('Edit pass error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== PASS VALIDATION & USAGE (Scanner Routes) ====================

// GET validate pass - SCANNER ONLY (REQUIRES AUTH)
router.get('/passes/:passId/validate', verifyToken, requireRole('venue', 'admin', 'scanner'), async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });
    
    if (!pass) {
      return res.status(404).json({ valid: false, error: 'Pass not found' });
    }
    
    if (pass.status !== 'active') {
      return res.status(400).json({ valid: false, error: 'Pass already used or expired' });
    }
    
    if (pass.validUntil && new Date() > pass.validUntil) {
      pass.status = 'expired';
      await pass.save();
      return res.status(400).json({ valid: false, error: 'Pass expired' });
    }
    
    res.json({ valid: true, pass });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST use pass - SCANNER ONLY (REQUIRES AUTH)
router.post('/passes/:passId/use', verifyToken, requireRole('venue', 'admin', 'scanner'), async (req, res) => {
  try {
    const pass = await Pass.findOne({ passId: req.params.passId });
    
    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }
    
    if (pass.status !== 'active') {
      return res.status(400).json({ error: 'Pass already used or expired' });
    }
    
    // Mark pass as used
    pass.status = 'used';
    pass.usedAt = new Date();
    pass.usedBy = req.userEmail;  // Track who scanned it
    await pass.save();
    
    // Update venue stats
    await Venue.findByIdAndUpdate(pass.venueId, {
      $inc: { inLine: -pass.quantity }
    });
    
    console.log(`✅ Pass USED: ${pass.passId} by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Pass used successfully' });
    
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== VENUE MANAGEMENT (Owner Routes) ====================

// PUT update venue pricing - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.put('/venue/pricing', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, newPrice } = req.body;
    
    if (!newPrice || newPrice < 10 || newPrice > 500) {
      return res.status(400).json({ error: 'Price must be between $10 and $500' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.currentPrice = newPrice;
    await venue.save();
    
    console.log(`💰 Price updated: ${venue.name} to $${newPrice} by ${req.userEmail}`);
    
    res.json({ success: true, newPrice });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST activate passes - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/venue/activate', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, availablePasses } = req.body;
    
    if (availablePasses < 0 || availablePasses > 500) {
      return res.status(400).json({ error: 'Passes must be between 0 and 500' });
    }
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = true;
    venue.availablePasses = availablePasses;
    await venue.save();
    
    console.log(`⚡ Passes activated: ${venue.name} (${availablePasses} passes) by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Passes activated' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST deactivate passes - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/venue/deactivate', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    venue.isActive = false;
    await venue.save();
    
    console.log(`❌ Passes deactivated: ${venue.name} by ${req.userEmail}`);
    
    res.json({ success: true, message: 'Passes deactivated' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET venue stats - VENUE OWNER or ADMIN (REQUIRES AUTH) - FIXED WITH AGGREGATION
router.get('/venue/:venueId/stats', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // Get today's transactions using FIXED aggregation (no more N+1 queries!)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const stats = await Transaction.aggregate([
      {
        $match: {
          venueId: new mongoose.Types.ObjectId(req.params.venueId),
          createdAt: { $gte: startOfDay }
        }
      },
      {
        $lookup: {
          from: 'passes',
          localField: 'passId',
          foreignField: 'passId',
          as: 'pass'
        }
      },
      {
        $unwind: { path: '$pass', preserveNullAndEmptyArrays: true }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$venueRevenue' },
          passesSold: { $sum: { $ifNull: ['$pass.quantity', 0] } }
        }
      }
    ]);
    
    const result = stats[0] || { revenue: 0, passesSold: 0 };
    
    res.json({
      revenue: Math.round(result.revenue),
      passesSold: result.passesSold,
      currentWait: venue.waitTime,
      inLine: venue.inLine
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST push notification - VENUE OWNER or ADMIN (REQUIRES AUTH)
router.post('/notifications/push', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, message, radius } = req.body;
    
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    // TODO: Find users within radius and send notifications
    
    res.json({ success: true, sent: 0, message: 'Feature coming soon' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET pricing suggestion - PUBLIC OR AUTH (Works either way)
router.get('/pricing/ml-suggest', async (req, res) => {
  try {
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const suggestion = LightningSauce.calculateOptimalPrice(
      venue,
      venue.waitTime,
      venue.capacity
    );

    res.json(suggestion);
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== STRIPE CONNECT & PAYOUTS ====================

// POST create Stripe Connect account for venue
router.post('/venue/connect/create', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { venueId, email } = req.body;

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    if (venue.stripeConnectId) {
      return res.status(400).json({ error: 'Venue already has Stripe Connect account' });
    }

    const account = await stripe.createConnectAccount(email, venue.name);
    venue.stripeConnectId = account.id;
    await venue.save();

    const accountLink = await stripe.createConnectAccountLink(
      account.id,
      `${process.env.FRONTEND_URL}/venue/connect/refresh`,
      `${process.env.FRONTEND_URL}/venue/connect/return`
    );

    console.log(`✅ Stripe Connect created for ${venue.name}`);

    res.json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url
    });

  } catch (error) {
    console.error('Connect account creation error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET venue revenue info (updated - no manual payouts)
router.get('/venue/:venueId/payout-info', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({
      lifetimeRevenue: venue.lifetimeRevenue || 0,
      totalPaidOut: venue.totalPaidOut || 0,
      lastPayoutAt: venue.lastPayoutAt,
      hasStripeConnect: !!venue.stripeConnectId,
      stripeConnectId: venue.stripeConnectId,
      autoPayoutsEnabled: !!venue.stripeConnectId,
      message: venue.stripeConnectId
        ? 'Payments automatically sent to your Stripe account after each sale (85% to you, 15% platform fee)'
        : 'Connect your Stripe account to receive automatic payouts'
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== PASS TEMPLATES ====================

// POST create pass template - VENUE OWNER or ADMIN
router.post('/venue/:venueId/pass-templates', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { name, description, price, tagline, features } = req.body;
    const { venueId } = req.params;

    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // REQUIRE STRIPE CONNECT BEFORE CREATING PASSES
    if (!venue.stripeConnectId) {
      return res.status(403).json({
        error: 'Please connect your bank account via Stripe Connect before creating passes',
        code: 'BANK_ACCOUNT_REQUIRED'
      });
    }

    const passTemplate = new PassTemplate({
      venueId: venue._id,
      venueName: venue.name,
      name,
      description,
      price,
      tagline,
      features: features || [],
      isActive: true
    });

    await passTemplate.save();

    console.log(`✅ Pass template created: ${name} for ${venue.name} ($${price})`);

    res.json({
      success: true,
      template: passTemplate
    });

  } catch (error) {
    console.error('Create pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET all pass templates for a venue - VENUE OWNER or ADMIN
router.get('/venue/:venueId/pass-templates', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const templates = await PassTemplate.find({ venueId: req.params.venueId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET public pass templates for a venue (for customer purchase)
router.get('/venues/:venueId/pass-templates', async (req, res) => {
  try {
    const templates = await PassTemplate.find({
      venueId: req.params.venueId,
      isActive: true
    }).sort({ price: 1 });

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// PUT update pass template - VENUE OWNER or ADMIN
router.put('/venue/:venueId/pass-templates/:templateId', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { name, description, price, tagline, features, isActive } = req.body;
    const { templateId } = req.params;

    const template = await PassTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    if (price) template.price = price;
    if (tagline !== undefined) template.tagline = tagline;
    if (features !== undefined) template.features = features;
    if (isActive !== undefined) template.isActive = isActive;

    await template.save();

    console.log(`✅ Pass template updated: ${template.name}`);

    res.json({
      success: true,
      template
    });

  } catch (error) {
    console.error('Update pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// DELETE pass template - VENUE OWNER or ADMIN
router.delete('/venue/:venueId/pass-templates/:templateId', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { templateId } = req.params;

    const template = await PassTemplate.findByIdAndDelete(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    console.log(`✅ Pass template deleted: ${template.name}`);

    res.json({
      success: true,
      message: 'Template deleted'
    });

  } catch (error) {
    console.error('Delete pass template error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ==================== REFUND SYSTEM ====================
//
// REFUND FLOW:
// Customer pays: $100
// Venue receives: $85 (auto-transferred to their Stripe Connect account)
// Platform receives: $15 (application fee)
//
// On refund:
// - Customer gets back: $85 (85% of original payment)
// - Platform keeps: $15 (non-refundable processing fee)
// - Venue loses: $85 (pulled from their Stripe Connect account via reverse_transfer)
//
// Stripe settings:
// - refund_application_fee: false (platform keeps 15%)
// - reverse_transfer: true (pull from venue's account, not platform)
//
// ====================================================================

const RefundRequest = require('../models/RefundRequest');

// GET customer's passes - CUSTOMER ONLY
router.get('/customer/passes', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const passes = await Pass.find({
      email: req.userEmail
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      passes
    });

  } catch (error) {
    console.error('Error loading customer passes:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST request refund - CUSTOMER ONLY
router.post('/passes/:passId/request-refund', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const { reason } = req.body;
    const { passId } = req.params;

    if (!reason || reason.length < 10) {
      return res.status(400).json({ error: 'Please provide a detailed reason (at least 10 characters)' });
    }

    // Get the pass
    const pass = await Pass.findOne({ passId });
    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    // Verify customer owns this pass
    if (pass.email !== req.userEmail) {
      return res.status(403).json({ error: 'This pass does not belong to you' });
    }

    // Check if pass is eligible for refund
    if (pass.status === 'refunded') {
      return res.status(400).json({ error: 'This pass has already been refunded' });
    }

    if (pass.status === 'used') {
      return res.status(400).json({ error: 'Cannot refund a pass that has been used' });
    }

    if (pass.refundRequested) {
      return res.status(400).json({ error: 'Refund already requested for this pass' });
    }

    // Create refund request
    const refundRequest = new RefundRequest({
      passId: pass.passId,
      customerId: req.userId,
      venueId: pass.venueId,
      customerEmail: pass.email,
      customerPhone: pass.phone,
      customerReason: reason,
      status: 'pending',
      refundAmount: pass.amount
    });

    await refundRequest.save();

    // Update pass
    pass.refundRequested = true;
    pass.refundRequestedAt = new Date();
    pass.refundStatus = 'pending';
    await pass.save();

    console.log(`📝 Refund requested: ${pass.passId} by ${req.userEmail}`);

    res.json({
      success: true,
      message: 'Refund request submitted successfully',
      refundRequest
    });

  } catch (error) {
    console.error('Request refund error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET customer's refund requests - CUSTOMER ONLY
router.get('/customer/refund-requests', verifyToken, requireRole('customer'), async (req, res) => {
  try {
    const requests = await RefundRequest.find({
      customerEmail: req.userEmail
    }).sort({ requestedAt: -1 });

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Error loading refund requests:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET venue's refund requests - VENUE OWNER or ADMIN
router.get('/venue/:venueId/refund-requests', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { venueId: req.params.venueId };

    if (status && status !== 'all') {
      filter.status = status;
    }

    const requests = await RefundRequest.find(filter).sort({ requestedAt: -1 });

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Error loading venue refund requests:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST respond to refund request (approve/deny) - VENUE OWNER or ADMIN
router.post('/venue/:venueId/refund-requests/:requestId/respond', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { action, denialReason } = req.body;
    const { requestId, venueId } = req.params;

    if (!['approve', 'deny'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "deny"' });
    }

    if (action === 'deny' && !denialReason) {
      return res.status(400).json({ error: 'Denial reason is required' });
    }

    // Get refund request
    const refundRequest = await RefundRequest.findById(requestId);
    if (!refundRequest) {
      return res.status(404).json({ error: 'Refund request not found' });
    }

    if (refundRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Refund request has already been processed' });
    }

    // Get the pass
    const pass = await Pass.findOne({ passId: refundRequest.passId });
    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    if (action === 'approve') {
      // Create Stripe refund
      const refund = await stripe.createRefund(
        pass.stripePaymentIntentId,
        null,
        'requested_by_customer'
      );

      // Update refund request
      refundRequest.status = 'approved';
      refundRequest.respondedAt = new Date();
      refundRequest.respondedBy = req.userEmail;
      refundRequest.stripeRefundId = refund.id;
      await refundRequest.save();

      // Update pass
      pass.status = 'refunded';
      pass.refundStatus = 'approved';
      pass.refundedAt = new Date();
      pass.refundedBy = req.userEmail;
      pass.stripeRefundId = refund.id;
      await pass.save();

      // Update transaction
      await Transaction.updateOne(
        { passId: pass.passId },
        { status: 'refunded' }
      );

      // Update venue revenue
      const venue = await Venue.findById(venueId);
      if (venue) {
        venue.lifetimeRevenue = Math.max(0, (venue.lifetimeRevenue || 0) - (pass.amount * 0.85));
        await venue.save();
      }

      // Send SMS notification
      try {
        const refundAmount = pass.amount * 0.85; // Customer gets 85%, platform keeps 15% fee
        await twilio.sendSMS(
          pass.phone,
          `✅ Your refund for ${pass.passName || 'General Admission'} at ${pass.venueName} has been APPROVED. $${refundAmount.toFixed(2)} will be returned to your card within 5-10 business days (15% processing fee applies). - Lightning Pass`
        );
      } catch (smsError) {
        console.error('SMS send failed:', smsError);
      }

      console.log(`✅ Refund APPROVED: ${pass.passId} by ${req.userEmail}`);

      res.json({
        success: true,
        message: 'Refund approved and processed',
        refund
      });

    } else {
      // Deny refund
      refundRequest.status = 'denied';
      refundRequest.respondedAt = new Date();
      refundRequest.respondedBy = req.userEmail;
      refundRequest.denialReason = denialReason;
      await refundRequest.save();

      // Update pass
      pass.refundRequested = false;
      pass.refundStatus = 'denied';
      await pass.save();

      // Send SMS notification
      try {
        await twilio.sendSMS(
          pass.phone,
          `❌ Your refund request for ${pass.passName || 'General Admission'} at ${pass.venueName} has been DENIED. Reason: ${denialReason} - Lightning Pass`
        );
      } catch (smsError) {
        console.error('SMS send failed:', smsError);
      }

      console.log(`❌ Refund DENIED: ${pass.passId} by ${req.userEmail}`);

      res.json({
        success: true,
        message: 'Refund request denied'
      });
    }

  } catch (error) {
    console.error('Respond to refund error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET search passes - VENUE OWNER or ADMIN
router.get('/venue/:venueId/passes/search', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { q } = req.query;
    const { venueId } = req.params;

    if (!q || q.length < 3) {
      return res.status(400).json({ error: 'Search query must be at least 3 characters' });
    }

    // Search by email, phone, or passId
    const searchQuery = {
      venueId: venueId,
      $or: [
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q.replace(/[^0-9+]/g, ''), $options: 'i' } },
        { passId: q.toUpperCase() }
      ]
    };

    const passes = await Pass.find(searchQuery).sort({ createdAt: -1 }).limit(20);

    res.json({
      success: true,
      passes,
      count: passes.length
    });

  } catch (error) {
    console.error('Search passes error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST venue-initiated refund - VENUE OWNER or ADMIN
router.post('/venue/:venueId/passes/:passId/refund', verifyToken, requireVenueOwnership, async (req, res) => {
  try {
    const { reason, notifyCustomer } = req.body;
    const { passId, venueId } = req.params;

    if (!reason) {
      return res.status(400).json({ error: 'Reason for refund is required' });
    }

    // Get the pass
    const pass = await Pass.findOne({ passId });
    if (!pass) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    // Verify venue owns this pass
    if (pass.venueId.toString() !== venueId) {
      return res.status(403).json({ error: 'This pass does not belong to your venue' });
    }

    // Check if already refunded
    if (pass.status === 'refunded') {
      return res.status(400).json({ error: 'This pass has already been refunded' });
    }

    // Create Stripe refund
    const refund = await stripe.createRefund(
      pass.stripePaymentIntentId,
      null,
      'requested_by_merchant'
    );

    // Create refund request record (for tracking)
    const refundRequest = new RefundRequest({
      passId: pass.passId,
      customerId: pass.userId,
      venueId: pass.venueId,
      customerEmail: pass.email,
      customerPhone: pass.phone,
      customerReason: 'Venue-initiated refund: ' + reason,
      status: 'approved',
      refundAmount: pass.amount,
      respondedAt: new Date(),
      respondedBy: req.userEmail,
      stripeRefundId: refund.id
    });
    await refundRequest.save();

    // Update pass
    pass.status = 'refunded';
    pass.refundStatus = 'venue_refunded';
    pass.refundedAt = new Date();
    pass.refundedBy = req.userEmail;
    pass.stripeRefundId = refund.id;
    await pass.save();

    // Update transaction
    await Transaction.updateOne(
      { passId: pass.passId },
      { status: 'refunded' }
    );

    // Update venue revenue
    const venue = await Venue.findById(venueId);
    if (venue) {
      venue.lifetimeRevenue = Math.max(0, (venue.lifetimeRevenue || 0) - (pass.amount * 0.85));
      await venue.save();
    }

    // Send SMS notification if requested
    if (notifyCustomer !== false) {
      try {
        const refundAmount = pass.amount * 0.85; // Customer gets 85%, platform keeps 15% fee
        await twilio.sendSMS(
          pass.phone,
          `💸 A refund of $${refundAmount.toFixed(2)} has been issued for your pass at ${pass.venueName}. The money will be returned to your card within 5-10 business days (15% processing fee applies). - Lightning Pass`
        );
      } catch (smsError) {
        console.error('SMS send failed:', smsError);
      }
    }

    console.log(`💸 Venue-initiated refund: ${pass.passId} by ${req.userEmail}`);

    res.json({
      success: true,
      message: 'Refund issued successfully',
      refund
    });

  } catch (error) {
    console.error('Venue refund error:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ===== SYSTEM SETTINGS =====
// Get promotional discount percentage
router.get('/system/settings', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const SystemSettings = require('../models/SystemSettings');

    let settings = await SystemSettings.findById('system');
    if (!settings) {
      // Create default settings if they don't exist
      settings = new SystemSettings({ _id: 'system' });
      await settings.save();
    }

    res.json({
      promotionalDiscountPercent: settings.promotionalDiscountPercent || 0,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update promotional discount percentage (admin only)
router.put('/system/settings', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { promotionalDiscountPercent } = req.body;

    if (promotionalDiscountPercent === undefined || promotionalDiscountPercent < 0 || promotionalDiscountPercent > 100) {
      return res.status(400).json({ error: 'Discount must be between 0 and 100' });
    }

    const SystemSettings = require('../models/SystemSettings');

    let settings = await SystemSettings.findById('system');
    if (!settings) {
      settings = new SystemSettings({ _id: 'system' });
    }

    settings.promotionalDiscountPercent = promotionalDiscountPercent;
    settings.updatedBy = req.userEmail;
    await settings.save();

    console.log(`✅ Promotional discount updated to ${promotionalDiscountPercent}% by ${req.userEmail}`);

    res.json({
      success: true,
      promotionalDiscountPercent: settings.promotionalDiscountPercent,
      message: `Promotional discount set to ${promotionalDiscountPercent}%`
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
