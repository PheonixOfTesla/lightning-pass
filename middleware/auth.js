const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Verify JWT token middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(403).json({ error: 'No token provided' });
  }
  
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : authHeader;
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    req.venueId = decoded.venueId;  // For venue owners
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require specific role(s) middleware
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.userRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.userRole
      });
    }
    
    next();
  };
}

// Require venue ownership middleware (for venue-specific actions)
function requireVenueOwnership(req, res, next) {
  const venueId = req.params.venueId || req.body.venueId;
  
  if (!venueId) {
    return res.status(400).json({ error: 'Venue ID required' });
  }
  
  // Admin can access any venue
  if (req.userRole === 'admin') {
    return next();
  }
  
  // Venue owner can only access their own venue
  if (req.userRole === 'venue' && req.venueId) {
    if (req.venueId.toString() !== venueId.toString()) {
      return res.status(403).json({ error: 'Access denied to this venue' });
    }
    return next();
  }
  
  return res.status(403).json({ error: 'Venue ownership required' });
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      venueId: user.venueId  // For venue owners
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Login endpoint - accepts email OR phone number
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email or phone number and password required' });
  }

  try {
    const User = require('../models/User');

    // Determine if input is phone number or email
    let user;
    const inputValue = email.trim();

    // Check if it looks like a phone number (contains only digits, spaces, dashes, parentheses, or starts with +)
    const isPhoneNumber = /^[\d\s\-\(\)\+]+$/.test(inputValue);

    if (isPhoneNumber) {
      // Format phone number and search by phone
      const formattedPhone = formatPhoneNumber(inputValue);
      user = await User.findOne({ phone: formattedPhone });
    } else {
      // Search by email
      user = await User.findOne({ email: inputValue.toLowerCase() });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    // Check if venue is still pending approval
    let venuePending = false;
    if (user.role === 'venue' && user.venueId) {
      const Venue = require('../models/Venue');
      const venue = await Venue.findById(user.venueId);
      venuePending = venue && venue.approvalStatus === 'pending';
    }

    console.log(`✅ User logged in: ${user.email} (${user.role})`);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        venueId: user.venueId,
        venuePending: venuePending
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Register endpoint (for venue owners and admins)
async function register(req, res) {
  const { email, password, role, venueId, verificationCode } = req.body;
  let phone = req.body.phone;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  // Auto-format phone number
  phone = formatPhoneNumber(phone);

  if (!verificationCode) {
    return res.status(400).json({ error: 'Phone verification code required' });
  }

  // Password strength check
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const User = require('../models/User');
    const twilio = require('../integrations/twilio');

    // Verify phone code using Twilio Verify API
    try {
      const verificationCheck = await twilio.verifyPhoneCode(phone, verificationCode);

      if (verificationCheck.status !== 'approved') {
        return res.status(400).json({ error: 'Invalid verification code' });
      }
    } catch (verifyError) {
      console.error('Verification check error:', verifyError);
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Check if user exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with phone verified
    const user = new User({
      email: email.toLowerCase(),
      phone: phone,  // Use formatted phone number
      phoneVerified: true,  // Phone verified via code
      passwordHash,
      role: role || 'customer',
      venueId: role === 'venue' ? venueId : undefined,
      wantsPromotions: req.body.wantsPromotions || false
    });

    await user.save();

    // If registering as venue owner, create pending venue application
    if (role === 'venue') {
      const Venue = require('../models/Venue');

      const venue = new Venue({
        name: req.body.venueName,
        type: req.body.venueType,
        address: req.body.venueAddress,
        ownerId: user._id,
        ownerEmail: user.email,
        ownerPhone: user.phone,
        approvalStatus: 'pending',  // Requires admin approval
        isActive: false  // Not active until approved
      });

      await venue.save();

      // Link venue to user
      user.venueId = venue._id;
      await user.save();

      console.log(`✅ Venue application created: ${venue.name} (${user.email}) - PENDING APPROVAL`);

      // 🔥 Real-time WebSocket notification to admin
      if (global.io) {
        global.io.to('admin').emit('newVenueApplication', {
          venueId: venue._id,
          venueName: venue.name,
          venueType: venue.type,
          ownerEmail: user.email,
          ownerPhone: user.phone,
          appliedAt: venue.appliedAt || venue.createdAt
        });
        console.log(`🔥 WebSocket: Emitted newVenueApplication for ${venue.name}`);
      }
    }

    // Generate token
    const token = generateToken(user);

    console.log(`✅ User registered: ${user.email} (${user.role})`);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        venueId: user.venueId,
        venuePending: role === 'venue' ? true : false  // Flag for pending venue approval
      }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// Format phone number to E.164 format (+1XXXXXXXXXX)
function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If it starts with 1 and has 11 digits, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If it has 10 digits, add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If it already has +, return as is
  if (phone.startsWith('+')) {
    return phone;
  }

  // Otherwise return with +1
  return `+1${digits}`;
}

// Send phone verification code endpoint using Twilio Verify API
async function sendVerificationCode(req, res) {
  let { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  // Auto-format phone number
  phone = formatPhoneNumber(phone);

  try {
    const twilio = require('../integrations/twilio');

    // Send verification code via Twilio Verify API (handles rate limiting automatically)
    const verification = await twilio.sendVerificationCode(phone);

    console.log(`✅ Verification code sent to ${phone} (status: ${verification.status})`);

    res.json({
      success: true,
      message: 'Verification code sent to your phone',
      expiresIn: 600  // seconds
    });

  } catch (error) {
    console.error('Send verification code error:', error);

    // Handle Twilio rate limit errors
    if (error.code === 60203) {
      return res.status(429).json({
        error: 'Too many verification requests. Please wait a few minutes.'
      });
    }

    res.status(500).json({ error: 'Failed to send verification code' });
  }
}

// Forgot password - send verification code to phone
async function forgotPassword(req, res) {
  let { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  phone = formatPhoneNumber(phone);

  try {
    const User = require('../models/User');

    // Check if user exists with this phone number
    const user = await User.findOne({ phone });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        success: true,
        message: 'If an account exists with this phone number, a verification code has been sent'
      });
    }

    const twilio = require('../integrations/twilio');

    // Send verification code via Twilio Verify API
    await twilio.sendVerificationCode(phone);

    console.log(`✅ Password reset code sent to ${phone}`);

    res.json({
      success: true,
      message: 'Verification code sent to your phone'
    });

  } catch (error) {
    console.error('Forgot password error:', error);

    if (error.code === 60203) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a few minutes.'
      });
    }

    res.status(500).json({ error: 'Failed to send verification code' });
  }
}

// Reset password with verification code
async function resetPassword(req, res) {
  let { phone, code, newPassword } = req.body;

  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'Phone number, verification code, and new password required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  phone = formatPhoneNumber(phone);

  try {
    const User = require('../models/User');
    const twilio = require('../integrations/twilio');

    // Verify code using Twilio Verify API
    try {
      const verificationCheck = await twilio.verifyPhoneCode(phone, code);

      if (verificationCheck.status !== 'approved') {
        return res.status(400).json({ error: 'Invalid verification code' });
      }
    } catch (verifyError) {
      console.error('Verification check error:', verifyError);
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Find user by phone
    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    user.passwordHash = passwordHash;
    await user.save();

    console.log(`✅ Password reset for ${user.email}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}

module.exports = {
  verifyToken,
  requireRole,
  requireVenueOwnership,
  generateToken,
  login,
  register,
  sendVerificationCode,
  forgotPassword,
  resetPassword
};
