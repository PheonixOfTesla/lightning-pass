#!/usr/bin/env node
/**
 * ADMIN MIGRATION SCRIPT: Fix venue ownerId
 *
 * Problem: Some venues were created with ownerEmail set but ownerId null.
 * This causes the scoping queries to return nothing for those hosts.
 *
 * Solution: Find venues where ownerId is null but ownerEmail matches a user,
 * and set ownerId = that user's _id.
 *
 * Usage:
 *   DRY RUN (see what would change):
 *     MONGODB_URI="mongodb+srv://..." node scripts/migrate-venue-ownership.js --dry-run
 *
 *   APPLY CHANGES:
 *     MONGODB_URI="mongodb+srv://..." node scripts/migrate-venue-ownership.js --apply
 *
 * The MONGODB_URI must be passed inline (not from .env) for production safety.
 * This script is IDEMPOTENT - running it multiple times has no effect after first run.
 */

const mongoose = require('mongoose');

// Inline models to avoid dotenv dependency
const userSchema = new mongoose.Schema({
  email: String,
  role: String
});
const User = mongoose.model('User', userSchema);

const venueSchema = new mongoose.Schema({
  name: String,
  ownerId: mongoose.Schema.Types.ObjectId,
  ownerEmail: String,
  ownerName: String,
  approvalStatus: String
});
const Venue = mongoose.model('Venue', venueSchema);

async function migrate() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isApply = args.includes('--apply');

  if (!isDryRun && !isApply) {
    console.log('Usage:');
    console.log('  MONGODB_URI="..." node scripts/migrate-venue-ownership.js --dry-run');
    console.log('  MONGODB_URI="..." node scripts/migrate-venue-ownership.js --apply');
    console.log('');
    console.log('You must specify either --dry-run or --apply');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGODB_URI environment variable required');
    console.error('Pass it inline: MONGODB_URI="mongodb+srv://..." node scripts/...');
    process.exit(1);
  }

  console.log('========================================');
  console.log('VENUE OWNERSHIP MIGRATION');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'APPLY (will modify database)'}`);
  console.log('========================================\n');

  try {
    // Connect
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find venues with missing ownerId
    const venuesWithMissingOwner = await Venue.find({
      $or: [
        { ownerId: null },
        { ownerId: { $exists: false } }
      ]
    });

    console.log(`Found ${venuesWithMissingOwner.length} venue(s) with missing ownerId\n`);

    if (venuesWithMissingOwner.length === 0) {
      console.log('✅ Nothing to migrate - all venues have ownerId set');
      await mongoose.disconnect();
      return;
    }

    // Process each venue
    const results = {
      willFix: [],
      noMatch: [],
      alreadyLinked: []
    };

    for (const venue of venuesWithMissingOwner) {
      console.log(`Processing: ${venue.name}`);
      console.log(`  ownerEmail: ${venue.ownerEmail || 'NOT SET'}`);
      console.log(`  ownerId: ${venue.ownerId || 'NULL'}`);

      if (!venue.ownerEmail) {
        console.log(`  ❌ Cannot fix: no ownerEmail to match against`);
        results.noMatch.push({
          name: venue.name,
          id: venue._id,
          reason: 'No ownerEmail set'
        });
        continue;
      }

      // Find user by email
      const user = await User.findOne({ email: venue.ownerEmail });

      if (!user) {
        console.log(`  ❌ Cannot fix: no user found with email ${venue.ownerEmail}`);
        results.noMatch.push({
          name: venue.name,
          id: venue._id,
          ownerEmail: venue.ownerEmail,
          reason: 'No user with this email'
        });
        continue;
      }

      console.log(`  ✅ Found user: ${user.email} (${user._id}) role=${user.role}`);

      if (isDryRun) {
        console.log(`  📋 WOULD SET ownerId = ${user._id}`);
        results.willFix.push({
          name: venue.name,
          venueId: venue._id,
          ownerEmail: venue.ownerEmail,
          userId: user._id,
          userRole: user.role
        });
      } else {
        // Apply the fix
        venue.ownerId = user._id;
        await venue.save();
        console.log(`  🔧 FIXED: ownerId = ${user._id}`);
        results.willFix.push({
          name: venue.name,
          venueId: venue._id,
          ownerEmail: venue.ownerEmail,
          userId: user._id,
          userRole: user.role,
          status: 'FIXED'
        });
      }

      console.log('');
    }

    // Summary
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Venues that ${isDryRun ? 'WILL BE' : 'WERE'} fixed: ${results.willFix.length}`);
    console.log(`Venues that cannot be fixed: ${results.noMatch.length}`);

    if (results.willFix.length > 0) {
      console.log('\n--- Venues to fix ---');
      results.willFix.forEach(v => {
        console.log(`  ${v.name}`);
        console.log(`    venueId: ${v.venueId}`);
        console.log(`    ownerEmail: ${v.ownerEmail}`);
        console.log(`    ${isDryRun ? 'will link to' : 'linked to'} userId: ${v.userId}`);
      });
    }

    if (results.noMatch.length > 0) {
      console.log('\n--- Venues that cannot be auto-fixed ---');
      results.noMatch.forEach(v => {
        console.log(`  ${v.name}: ${v.reason}`);
      });
    }

    if (isDryRun && results.willFix.length > 0) {
      console.log('\n⚠️  DRY RUN COMPLETE - No changes made');
      console.log('To apply these changes, run with --apply instead of --dry-run');
    }

    await mongoose.disconnect();
    console.log('\n✅ Done');

  } catch (error) {
    console.error('Migration error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

migrate();
