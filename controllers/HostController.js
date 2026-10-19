const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Venue = require('../models/Venue');
const Pass = require('../models/Pass');
const User = require('../models/User');
const EmailLog = require('../models/EmailLog');
const QRCode = require('../utils/qrCode');
const { verifyToken, requireRole } = require('../middleware/auth');

// Daily email limit per host
const HOST_EMAIL_DAILY_LIMIT = 200;
const BULK_GENERATE_LIMIT = 100;

// Helper: Generate unique pass ID
function generatePassId() {
  return `LP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

// Helper: Send email (using Resend if available, otherwise log)
async function sendHostEmail({ to, subject, body, hostName, venueName }) {
  // Check if Resend is configured
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Lightning Pass <noreply@lightningpass.io>',
        to: to,
        subject: subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px; border-radius: 8px 8px 0 0;">
              <h1 style="color: #ffdd00; margin: 0; font-size: 24px;">Lightning Pass</h1>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="color: #333; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${body}</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="color: #666; font-size: 14px; margin: 0;">From ${hostName || venueName || 'your host'}</p>
            </div>
          </div>
        `
      });

      console.log(`📧 Email sent to ${to} from ${hostName || venueName}`);
      return { success: true };
    } catch (error) {
      console.error('Resend email error:', error);
      throw error;
    }
  } else {
    // Log email for development/testing
    console.log(`📧 [DEV] Would send email to ${to}:`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body: ${body.substring(0, 100)}...`);
    return { success: true, dev: true };
  }
}

// Helper: Send pass confirmation email
async function sendPassConfirmationEmail({ email, guestName, passId, venueName, quantity, customMessage }) {
  const subject = `Your Lightning Pass for ${venueName}`;
  const body = `Hi ${guestName},

${customMessage ? customMessage + '\n\n' : ''}You've been issued a complimentary Lightning Pass!

Pass Details:
- Venue: ${venueName}
- Pass ID: ${passId}
- Quantity: ${quantity}

Show your QR code at the door for fast entry.

See you there!`;

  return sendHostEmail({
    to: email,
    subject,
    body,
    venueName
  });
}

// ==================== GENERATE ENDPOINTS ====================

// POST /host/generate/comp - Generate complimentary pass for host's own venue
router.post('/generate/comp', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const { venueId, guestName, guestEmail, quantity = 1, sendEmail = true, customMessage } = req.body;

    // Validate input
    if (!venueId || !guestName) {
      return res.status(400).json({ error: 'Venue ID and guest name are required' });
    }

    if (quantity < 1 || quantity > 10) {
      return res.status(400).json({ error: 'Quantity must be between 1 and 10' });
    }

    // SCOPING: Verify host owns this venue (admin can access any)
    let venue;
    if (req.userRole === 'admin') {
      venue = await Venue.findById(venueId);
    } else {
      venue = await Venue.findOne({ _id: venueId, ownerId: req.userId });
    }

    if (!venue) {
      return res.status(403).json({ error: 'You can only generate passes for your own venues' });
    }

    // Generate pass
    const passId = generatePassId();
    const qrCodeData = await QRCode.generate(passId);

    const newPass = new Pass({
      passId,
      venueId: venue._id,
      venueName: venue.name,
      email: guestEmail || '',
      phone: '',
      purchasePrice: 0,
      quantity: parseInt(quantity),
      amount: 0,  // Comp = free
      qrCode: qrCodeData,
      status: 'active',
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),  // 30 days validity for comps
      passName: 'Complimentary Pass',
      passDescription: `Issued to ${guestName}`,
      // Track host-generated comp
      isComp: true,
      generationType: 'host_comp',
      generatedBy: req.userId
    });

    await newPass.save();

    console.log(`✅ Comp pass generated: ${passId} for ${guestName} at ${venue.name} by ${req.userEmail}`);

    // Send email if requested and email provided
    let emailSent = false;
    if (sendEmail && guestEmail) {
      try {
        await sendPassConfirmationEmail({
          email: guestEmail,
          guestName,
          passId,
          venueName: venue.name,
          quantity,
          customMessage
        });
        emailSent = true;
      } catch (emailError) {
        console.error('Email send failed:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.json({
      success: true,
      passId,
      pass: newPass,
      emailSent
    });

  } catch (error) {
    console.error('Generate comp error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate pass' });
  }
});

// POST /host/generate/bulk - Bulk generate passes
router.post('/generate/bulk', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const { venueId, recipients, sendEmails = true, customMessage } = req.body;

    // Validate input
    if (!venueId || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ error: 'Venue ID and recipients array are required' });
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient required' });
    }

    if (recipients.length > BULK_GENERATE_LIMIT) {
      return res.status(400).json({ error: `Maximum ${BULK_GENERATE_LIMIT} recipients per bulk operation` });
    }

    // SCOPING: Verify host owns this venue
    let venue;
    if (req.userRole === 'admin') {
      venue = await Venue.findById(venueId);
    } else {
      venue = await Venue.findOne({ _id: venueId, ownerId: req.userId });
    }

    if (!venue) {
      return res.status(403).json({ error: 'You can only generate passes for your own venues' });
    }

    const results = [];

    for (const recipient of recipients) {
      try {
        const { name, email, quantity = 1 } = recipient;

        if (!name) {
          results.push({ name, email, success: false, error: 'Name required' });
          continue;
        }

        // Generate pass
        const passId = generatePassId();
        const qrCodeData = await QRCode.generate(passId);

        const newPass = new Pass({
          passId,
          venueId: venue._id,
          venueName: venue.name,
          email: email || '',
          phone: '',
          purchasePrice: 0,
          quantity: parseInt(quantity) || 1,
          amount: 0,
          qrCode: qrCodeData,
          status: 'active',
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          passName: 'Complimentary Pass',
          passDescription: `Issued to ${name}`,
          isComp: true,
          generationType: 'host_bulk',
          generatedBy: req.userId
        });

        await newPass.save();

        let emailSent = false;
        if (sendEmails && email) {
          try {
            await sendPassConfirmationEmail({
              email,
              guestName: name,
              passId,
              venueName: venue.name,
              quantity: parseInt(quantity) || 1,
              customMessage
            });
            emailSent = true;
          } catch (emailError) {
            console.error(`Email failed for ${email}:`, emailError.message);
          }
        }

        results.push({
          name,
          email,
          success: true,
          passId,
          emailSent
        });

      } catch (error) {
        results.push({
          name: recipient.name,
          email: recipient.email,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Bulk generated ${successCount}/${recipients.length} passes for ${venue.name} by ${req.userEmail}`);

    res.json({
      success: true,
      created: successCount,
      total: recipients.length,
      results
    });

  } catch (error) {
    console.error('Bulk generate error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate passes' });
  }
});

// ==================== GUESTS ENDPOINTS ====================

// GET /host/guests - Get all unique guests from host's venues
router.get('/guests', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    // Get all venues owned by this host (admin sees all)
    let hostVenueIds;
    if (req.userRole === 'admin') {
      hostVenueIds = await Venue.find().distinct('_id');
    } else {
      hostVenueIds = await Venue.find({ ownerId: req.userId }).distinct('_id');
    }

    if (hostVenueIds.length === 0) {
      return res.json({ success: true, guests: [], total: 0 });
    }

    // Aggregate unique guests from passes to host's venues
    const guests = await Pass.aggregate([
      { $match: { venueId: { $in: hostVenueIds } } },
      { $group: {
        _id: { $toLower: '$email' },
        name: { $first: { $ifNull: ['$passDescription', 'Guest'] } },
        email: { $first: '$email' },
        phone: { $first: '$phone' },
        passCount: { $sum: 1 },
        totalSpent: { $sum: '$amount' },
        firstPurchase: { $min: '$createdAt' },
        lastPurchase: { $max: '$createdAt' },
        venueIds: { $addToSet: '$venueId' },
        venueNames: { $addToSet: '$venueName' }
      }},
      { $match: { _id: { $ne: '' } } },  // Exclude empty emails
      { $sort: { lastPurchase: -1 } },
      { $limit: 500 }
    ]);

    // Format the response
    const formattedGuests = guests.map(g => ({
      email: g.email,
      name: g.name,
      phone: g.phone,
      passCount: g.passCount,
      totalSpent: g.totalSpent,
      firstPurchase: g.firstPurchase,
      lastPurchase: g.lastPurchase,
      venues: g.venueNames
    }));

    res.json({ success: true, guests: formattedGuests, total: formattedGuests.length });

  } catch (error) {
    console.error('Get guests error:', error);
    res.status(500).json({ error: error.message || 'Failed to load guests' });
  }
});

// GET /host/guests/by-venue/:venueId - Get guests for specific venue
router.get('/guests/by-venue/:venueId', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const { venueId } = req.params;

    // SCOPING: Verify host owns this venue
    let venue;
    if (req.userRole === 'admin') {
      venue = await Venue.findById(venueId);
    } else {
      venue = await Venue.findOne({ _id: venueId, ownerId: req.userId });
    }

    if (!venue) {
      return res.status(403).json({ error: 'Not your venue' });
    }

    const passes = await Pass.find({ venueId: venue._id })
      .select('passId email phone quantity amount status createdAt passName passDescription isComp')
      .sort({ createdAt: -1 })
      .limit(500);

    res.json({
      success: true,
      venue: { id: venue._id, name: venue.name },
      guests: passes
    });

  } catch (error) {
    console.error('Get guests by venue error:', error);
    res.status(500).json({ error: error.message || 'Failed to load guests' });
  }
});

// ==================== EMAIL ENDPOINTS ====================

// POST /host/email/send - Send email to guests (scoped + rate-limited)
router.post('/email/send', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const { recipients, subject, body, venueId } = req.body;

    // Validate input
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients array required' });
    }

    if (!subject || !body) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }

    if (subject.length > 200) {
      return res.status(400).json({ error: 'Subject too long (max 200 characters)' });
    }

    if (body.length > 5000) {
      return res.status(400).json({ error: 'Body too long (max 5000 characters)' });
    }

    // Get host's venue IDs for scoping
    let hostVenueIds;
    if (req.userRole === 'admin') {
      hostVenueIds = await Venue.find().distinct('_id');
    } else {
      hostVenueIds = await Venue.find({ ownerId: req.userId }).distinct('_id');
    }

    if (hostVenueIds.length === 0) {
      return res.status(400).json({ error: 'You have no venues' });
    }

    // Get valid recipient emails (from passes to host's venues)
    const recipientEmails = recipients.map(r => (typeof r === 'string' ? r : r.email).toLowerCase());

    const validEmails = await Pass.find({
      venueId: { $in: hostVenueIds },
      email: { $in: recipientEmails }
    }).distinct('email');

    // Convert to lowercase for comparison
    const validEmailsLower = validEmails.map(e => e.toLowerCase());

    // Check for invalid recipients
    const invalidEmails = recipientEmails.filter(e => !validEmailsLower.includes(e));

    if (invalidEmails.length > 0) {
      return res.status(403).json({
        error: 'Cannot email users outside your audience',
        invalidEmails: invalidEmails.slice(0, 10),  // Return first 10 invalid
        invalidCount: invalidEmails.length
      });
    }

    // RATE LIMIT CHECK (skip for admin)
    if (req.userRole !== 'admin') {
      const user = await User.findById(req.userId);
      const today = new Date().toDateString();
      const lastReset = user.hostEmailsLastReset?.toDateString();

      if (lastReset !== today) {
        // Reset daily counter
        user.hostEmailsToday = 0;
        user.hostEmailsLastReset = new Date();
        await user.save();
      }

      if (user.hostEmailsToday + validEmailsLower.length > HOST_EMAIL_DAILY_LIMIT) {
        return res.status(429).json({
          error: `Daily email limit reached (${HOST_EMAIL_DAILY_LIMIT}/day)`,
          remaining: Math.max(0, HOST_EMAIL_DAILY_LIMIT - user.hostEmailsToday),
          limit: HOST_EMAIL_DAILY_LIMIT
        });
      }
    }

    // Get venue name for email context
    let venueName = '';
    if (venueId) {
      const venue = await Venue.findById(venueId);
      venueName = venue?.name || '';
    } else if (hostVenueIds.length === 1) {
      const venue = await Venue.findById(hostVenueIds[0]);
      venueName = venue?.name || '';
    }

    // Get host display name
    const hostUser = await User.findById(req.userId);
    const hostName = hostUser?.hostDisplayName || hostUser?.email || 'Your Host';

    // Create email log
    const emailLog = new EmailLog({
      senderType: req.userRole === 'admin' ? 'admin' : 'host',
      senderId: req.userId,
      senderEmail: req.userEmail,
      subject,
      bodyPreview: body.substring(0, 500),
      recipientCount: validEmailsLower.length,
      recipientEmails: validEmailsLower,
      venueId: venueId || (hostVenueIds.length === 1 ? hostVenueIds[0] : null),
      venueName
    });

    // Send emails
    let sentCount = 0, failedCount = 0;
    const failedEmails = [];

    for (const email of validEmailsLower) {
      try {
        await sendHostEmail({
          to: email,
          subject,
          body,
          hostName,
          venueName
        });
        sentCount++;
      } catch (err) {
        failedCount++;
        failedEmails.push({ email, error: err.message });
      }
    }

    // Update user's daily count (if not admin)
    if (req.userRole !== 'admin') {
      await User.findByIdAndUpdate(req.userId, {
        $inc: { hostEmailsToday: sentCount }
      });
    }

    // Complete email log
    emailLog.sentCount = sentCount;
    emailLog.failedCount = failedCount;
    emailLog.failedEmails = failedEmails;
    emailLog.completedAt = new Date();
    await emailLog.save();

    console.log(`📧 Host email sent: ${sentCount}/${validEmailsLower.length} by ${req.userEmail}`);

    // Get remaining quota
    let remaining = HOST_EMAIL_DAILY_LIMIT;
    if (req.userRole !== 'admin') {
      const updatedUser = await User.findById(req.userId);
      remaining = Math.max(0, HOST_EMAIL_DAILY_LIMIT - (updatedUser?.hostEmailsToday || 0));
    }

    res.json({
      success: true,
      sentCount,
      failedCount,
      remaining,
      limit: HOST_EMAIL_DAILY_LIMIT
    });

  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ error: error.message || 'Failed to send emails' });
  }
});

// GET /host/email/logs - Get email send logs for this host
router.get('/email/logs', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    let filter;
    if (req.userRole === 'admin') {
      // Admin sees all logs
      filter = {};
    } else {
      // Host sees only their logs
      filter = {
        senderType: 'host',
        senderId: req.userId
      };
    }

    const logs = await EmailLog.find(filter)
      .sort({ sentAt: -1 })
      .limit(50)
      .select('-recipientEmails');  // Don't return full email list

    res.json({ success: true, logs });

  } catch (error) {
    console.error('Get email logs error:', error);
    res.status(500).json({ error: error.message || 'Failed to load email logs' });
  }
});

// GET /host/email/quota - Get remaining email quota
router.get('/email/quota', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    if (req.userRole === 'admin') {
      return res.json({
        success: true,
        used: 0,
        remaining: 'unlimited',
        limit: 'unlimited'
      });
    }

    const user = await User.findById(req.userId);
    const today = new Date().toDateString();
    const lastReset = user?.hostEmailsLastReset?.toDateString();

    let used = 0;
    if (lastReset === today) {
      used = user?.hostEmailsToday || 0;
    }

    res.json({
      success: true,
      used,
      remaining: Math.max(0, HOST_EMAIL_DAILY_LIMIT - used),
      limit: HOST_EMAIL_DAILY_LIMIT
    });

  } catch (error) {
    console.error('Get email quota error:', error);
    res.status(500).json({ error: error.message || 'Failed to load quota' });
  }
});

// ==================== DIAGNOSTIC ENDPOINT ====================

// GET /host/diagnostic - Check ownership links (for debugging)
router.get('/diagnostic', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    const result = {
      currentUser: {
        userId: req.userId,
        email: req.userEmail,
        role: req.userRole
      },
      venues: [],
      summary: {}
    };

    // Get all venues for this host
    let venues;
    if (req.userRole === 'admin') {
      venues = await Venue.find().select('name ownerId ownerEmail ownerName approvalStatus');
    } else {
      venues = await Venue.find({ ownerId: req.userId }).select('name ownerId ownerEmail ownerName approvalStatus');
    }

    // Also check for venues matching by ownerEmail (for diagnosis)
    const user = await User.findById(req.userId);
    const venuesByEmail = await Venue.find({ ownerEmail: user?.email }).select('name ownerId ownerEmail approvalStatus');

    result.venues = venues.map(v => ({
      id: v._id,
      name: v.name,
      ownerId: v.ownerId?.toString() || 'NULL',
      ownerIdMatches: v.ownerId?.toString() === req.userId,
      ownerEmail: v.ownerEmail,
      approvalStatus: v.approvalStatus
    }));

    result.venuesByEmail = venuesByEmail.map(v => ({
      id: v._id,
      name: v.name,
      ownerId: v.ownerId?.toString() || 'NULL',
      ownerIdMatches: v.ownerId?.toString() === req.userId,
      ownerEmail: v.ownerEmail,
      approvalStatus: v.approvalStatus,
      NEEDS_FIX: !v.ownerId || v.ownerId?.toString() !== req.userId
    }));

    // Count passes per venue
    for (const venue of result.venues) {
      const passCount = await Pass.countDocuments({ venueId: venue.id });
      venue.passCount = passCount;
    }

    result.summary = {
      linkedVenues: result.venues.filter(v => v.ownerIdMatches).length,
      unlinkedVenuesByEmail: result.venuesByEmail.filter(v => v.NEEDS_FIX).length,
      issue: result.venues.length === 0 && result.venuesByEmail.length > 0
        ? 'Venues exist with your email but ownerId is not set - needs database fix'
        : result.venues.length === 0
        ? 'No venues linked to your account'
        : 'OK'
    };

    res.json({ success: true, diagnostic: result });

  } catch (error) {
    console.error('Diagnostic error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /host/fix-ownership - ADMIN ONLY - Fix missing ownerId for venues
// SECURITY: Hosts cannot self-serve ownership - that would be privilege escalation
router.post('/fix-ownership', verifyToken, requireRole('admin'), async (req, res) => {
  // Only admins can fix ownership - hosts seeing this endpoint get 403
  try {
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId required (admin must specify which user to fix)' });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    // Find venues where ownerEmail matches but ownerId is missing
    const venuesNeedingFix = await Venue.find({
      ownerEmail: user.email,
      $or: [
        { ownerId: null },
        { ownerId: { $exists: false } }
      ]
    });

    if (venuesNeedingFix.length === 0) {
      return res.json({
        success: true,
        message: 'No venues need ownership fix for this user',
        fixed: 0
      });
    }

    // Fix the ownership
    const fixedNames = [];
    for (const venue of venuesNeedingFix) {
      venue.ownerId = user._id;
      await venue.save();
      fixedNames.push(venue.name);
      console.log(`🔧 [ADMIN] Fixed ownership: ${venue.name} -> ${user.email} (${user._id}) by ${req.userEmail}`);
    }

    res.json({
      success: true,
      message: `Fixed ownership for ${fixedNames.length} venue(s)`,
      fixed: fixedNames.length,
      venues: fixedNames,
      targetUser: user.email
    });

  } catch (error) {
    console.error('Fix ownership error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== VENUES LIST (for host portal dropdown) ====================

// GET /host/venues - Get venues owned by this host
router.get('/venues', verifyToken, requireRole('venue', 'admin'), async (req, res) => {
  try {
    let venues;
    if (req.userRole === 'admin') {
      venues = await Venue.find().sort({ name: 1 });
    } else {
      venues = await Venue.find({ ownerId: req.userId }).sort({ name: 1 });
    }

    res.json({
      success: true,
      venues: venues.map(v => ({
        id: v._id,
        name: v.name,
        isActive: v.isActive,
        approvalStatus: v.approvalStatus
      }))
    });

  } catch (error) {
    console.error('Get venues error:', error);
    res.status(500).json({ error: error.message || 'Failed to load venues' });
  }
});

module.exports = router;
