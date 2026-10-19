/**
 * Diagnostic script to check venue ownership links
 * Run with: node scripts/check-ownership.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Models
const Venue = require('../models/Venue');
const User = require('../models/User');
const Pass = require('../models/Pass');

async function checkOwnership() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // 1. Find "The Deep End" venue
    console.log('=== STEP 1: Finding "The Deep End" venue ===');
    const deepEnd = await Venue.findOne({ name: /deep end/i });

    if (!deepEnd) {
      console.log('❌ "The Deep End" venue NOT FOUND in database');
      console.log('\nSearching for all venues...');
      const allVenues = await Venue.find().select('name ownerId ownerEmail approvalStatus');
      console.log('All venues:');
      allVenues.forEach(v => {
        console.log(`  - ${v.name} | ownerId: ${v.ownerId || 'NULL'} | ownerEmail: ${v.ownerEmail || 'N/A'} | status: ${v.approvalStatus}`);
      });
      await mongoose.disconnect();
      return;
    }

    console.log('✅ Found venue:');
    console.log(`   Name: ${deepEnd.name}`);
    console.log(`   Venue ID: ${deepEnd._id}`);
    console.log(`   ownerId: ${deepEnd.ownerId || 'NULL/UNSET'}`);
    console.log(`   ownerEmail: ${deepEnd.ownerEmail || 'N/A'}`);
    console.log(`   ownerName: ${deepEnd.ownerName || 'N/A'}`);
    console.log(`   approvalStatus: ${deepEnd.approvalStatus}`);

    // 2. Find all host users (role = 'venue')
    console.log('\n=== STEP 2: Finding host users (role=venue) ===');
    const hosts = await User.find({ role: 'venue' }).select('email venueId _id');

    if (hosts.length === 0) {
      console.log('❌ No users with role "venue" found');
    } else {
      console.log(`Found ${hosts.length} host user(s):`);
      hosts.forEach(h => {
        console.log(`  - ${h.email} | userId: ${h._id} | venueId: ${h.venueId || 'NULL'}`);
      });
    }

    // 3. Check if ownerId matches any host
    console.log('\n=== STEP 3: Checking ownership link ===');
    if (!deepEnd.ownerId) {
      console.log('❌ PROBLEM: The Deep End has NO ownerId set!');
      console.log('   This is why hosts see empty lists - the scoping query returns nothing.');

      // Find likely owner by email match
      if (deepEnd.ownerEmail) {
        const likelyOwner = await User.findOne({ email: deepEnd.ownerEmail });
        if (likelyOwner) {
          console.log(`\n🔧 FIX AVAILABLE: Found user with matching email:`);
          console.log(`   User: ${likelyOwner.email} (${likelyOwner._id})`);
          console.log(`   To fix, run: db.venues.updateOne({_id: ObjectId("${deepEnd._id}")}, {$set: {ownerId: ObjectId("${likelyOwner._id}")}})`);
        }
      }
    } else {
      const ownerUser = await User.findById(deepEnd.ownerId);
      if (ownerUser) {
        console.log(`✅ ownerId links to user: ${ownerUser.email}`);
        console.log(`   User role: ${ownerUser.role}`);

        if (ownerUser.role !== 'venue') {
          console.log(`   ⚠️ WARNING: User role is "${ownerUser.role}", not "venue"`);
        }
      } else {
        console.log(`❌ PROBLEM: ownerId (${deepEnd.ownerId}) does not match any user!`);
      }
    }

    // 4. Check passes for this venue
    console.log('\n=== STEP 4: Checking passes for The Deep End ===');
    const passCount = await Pass.countDocuments({ venueId: deepEnd._id });
    console.log(`   Total passes: ${passCount}`);

    if (passCount > 0) {
      const recentPasses = await Pass.find({ venueId: deepEnd._id })
        .select('passId email status createdAt')
        .sort({ createdAt: -1 })
        .limit(5);
      console.log('   Recent passes:');
      recentPasses.forEach(p => {
        console.log(`     - ${p.passId} | ${p.email} | ${p.status} | ${p.createdAt.toISOString().split('T')[0]}`);
      });
    }

    // 5. Summary
    console.log('\n=== SUMMARY ===');
    if (!deepEnd.ownerId) {
      console.log('🔴 BROKEN: Venue has no ownerId - host portal will show empty lists');
      console.log('   ACTION NEEDED: Set ownerId to the host user\'s _id');
    } else {
      const ownerUser = await User.findById(deepEnd.ownerId);
      if (ownerUser && ownerUser.role === 'venue') {
        console.log('🟢 OK: Venue ownership is correctly linked');
      } else {
        console.log('🟡 PARTIAL: ownerId exists but user role may be wrong');
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ Done');

  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkOwnership();
