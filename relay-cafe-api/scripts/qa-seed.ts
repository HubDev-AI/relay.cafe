/**
 * QA Seed Script — Create test data for manual iOS testing
 *
 * Usage: cd relay-cafe-api && bun run scripts/qa-seed.ts <command> [args]
 *
 * Commands:
 *   list-users                           List all users with moderation state
 *   create-sender [label]                Create a fake sender user
 *   create-message <senderId> [text]     Create an encrypted message from sender
 *   reset-tokens <userId>                Clear daily_tokens so user can send/receive
 *   set-strikes <userId> <count> [daysAgo]  Set strike_count (optionally backdate last_strike_at)
 *   set-suspension <userId> <days>       Set suspension_until to N days from now (use negative for past)
 *   clear-suspension <userId>            Remove suspension_until
 *   show-user <userId>                   Show user moderation state
 *   show-reports                         Show all report records
 *   show-deleted                         Show deleted_accounts table
 *   clear-cooldown                       Clear all cooldown_until in deleted_accounts
 *   clear-all                            Wipe everything (nuclear reset)
 */

import { db } from '../src/db'
import { users, sessions, dailyTokens, messages, deliveryLog, reports, blockedSenders, deletedAccounts } from '../src/db/schema'
import { sql, eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { encryptMessage } from '../src/lib/crypto'
import { wrapKey } from '../src/lib/kms'

const command = process.argv[2]
const args = process.argv.slice(3)

async function main() {
  if (!command) {
    console.log('Usage: bun run scripts/qa-seed.ts <command> [args]')
    console.log('Run with --help to see available commands')
    process.exit(1)
  }

  switch (command) {
    case 'list-users': {
      const allUsers = await db
        .select({
          id: users.id,
          appleIdHash: users.appleIdHash,
          strikeCount: users.strikeCount,
          suspensionUntil: users.suspensionUntil,
          lastStrikeAt: users.lastStrikeAt,
          createdAt: users.createdAt,
        })
        .from(users)
      if (allUsers.length === 0) {
        console.log('No users found.')
      } else {
        for (const u of allUsers) {
          const isSuspended = u.suspensionUntil && u.suspensionUntil > new Date()
          const hashPrefix = u.appleIdHash.slice(0, 12)
          console.log(
            `  ${u.id}  hash:${hashPrefix}...  strikes:${u.strikeCount}  ` +
            `suspended:${isSuspended ? `YES until ${u.suspensionUntil!.toISOString()}` : 'no'}  ` +
            `created:${u.createdAt.toISOString()}`
          )
        }
      }
      break
    }

    case 'create-sender': {
      const label = args[0] || `fake-${randomUUID().slice(0, 8)}`
      const appleIdHash = createHash('sha256').update(`qa-sender-${label}`).digest('hex')
      const [user] = await db.insert(users).values({ appleIdHash }).returning()
      console.log(`Created sender: ${user!.id}  (label: ${label})`)
      break
    }

    case 'create-message': {
      const senderId = args[0]
      const text = args.slice(1).join(' ') || 'Hello from a stranger'
      if (!senderId) {
        console.error('Usage: create-message <senderId> [text]')
        process.exit(1)
      }
      const { ciphertext, iv, key } = await encryptMessage(text)
      const { encryptedKey, keyVersion } = await wrapKey(key)
      const ttlMs = (Number(process.env.MESSAGE_TTL_SECONDS) || 86400) * 1000
      const expiresAt = new Date(Date.now() + ttlMs)

      const [msg] = await db.insert(messages).values({
        senderUserId: senderId,
        ciphertext,
        encryptedMessageKey: encryptedKey,
        kmsKeyVersion: keyVersion,
        iv,
        expiresAt,
      }).returning()
      console.log(`Created message: ${msg!.id}  expires: ${expiresAt.toISOString()}`)
      break
    }

    case 'reset-tokens': {
      const userId = args[0]
      if (!userId) {
        console.error('Usage: reset-tokens <userId>')
        process.exit(1)
      }
      const deleted = await db.delete(dailyTokens).where(eq(dailyTokens.userId, userId)).returning()
      console.log(`Cleared ${deleted.length} token row(s) for ${userId}`)
      break
    }

    case 'set-strikes': {
      const userId = args[0]
      const count = parseInt(args[1] ?? '', 10)
      const daysAgo = parseInt(args[2] ?? '0', 10)
      if (!userId || isNaN(count)) {
        console.error('Usage: set-strikes <userId> <count> [daysAgo]')
        process.exit(1)
      }
      const lastStrikeAt = daysAgo > 0
        ? new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
        : new Date()
      await db.update(users).set({
        strikeCount: count,
        lastStrikeAt,
      }).where(eq(users.id, userId))
      console.log(`Set strikes: ${count}  lastStrikeAt: ${lastStrikeAt.toISOString()}`)
      break
    }

    case 'set-suspension': {
      const userId = args[0]
      const days = parseFloat(args[1] ?? '')
      if (!userId || isNaN(days)) {
        console.error('Usage: set-suspension <userId> <days> (negative = past)')
        process.exit(1)
      }
      const suspensionUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      await db.update(users).set({ suspensionUntil }).where(eq(users.id, userId))
      console.log(`Set suspension_until: ${suspensionUntil.toISOString()}`)
      break
    }

    case 'clear-suspension': {
      const userId = args[0]
      if (!userId) {
        console.error('Usage: clear-suspension <userId>')
        process.exit(1)
      }
      await db.update(users).set({ suspensionUntil: null, strikeCount: 0 }).where(eq(users.id, userId))
      console.log(`Cleared suspension and strikes for ${userId}`)
      break
    }

    case 'show-user': {
      const userId = args[0]
      if (!userId) {
        console.error('Usage: show-user <userId>')
        process.exit(1)
      }
      const [user] = await db.select().from(users).where(eq(users.id, userId))
      if (!user) {
        console.log('User not found.')
      } else {
        const isSuspended = user.suspensionUntil && user.suspensionUntil > new Date()
        console.log(`  ID:             ${user.id}`)
        console.log(`  appleIdHash:    ${user.appleIdHash.slice(0, 20)}...`)
        console.log(`  strikeCount:    ${user.strikeCount}`)
        console.log(`  lastStrikeAt:   ${user.lastStrikeAt?.toISOString() ?? 'null'}`)
        console.log(`  suspensionUntil: ${user.suspensionUntil?.toISOString() ?? 'null'}`)
        console.log(`  suspended NOW:  ${isSuspended ? 'YES' : 'no'}`)
        console.log(`  createdAt:      ${user.createdAt.toISOString()}`)
      }
      break
    }

    case 'show-reports': {
      const allReports = await db.select().from(reports)
      if (allReports.length === 0) {
        console.log('No reports.')
      } else {
        for (const r of allReports) {
          console.log(
            `  ${r.id}  msg:${r.messageId.slice(0, 8)}...  ` +
            `reporter:${r.reporterUserId?.slice(0, 8) ?? 'NULL'}  ` +
            `sender:${r.senderUserId?.slice(0, 8) ?? 'NULL'}  ` +
            `action:${r.actionTaken}  strikes_after:${r.strikeCountAfter}  ` +
            `at:${r.createdAt.toISOString()}`
          )
        }
      }
      break
    }

    case 'show-deleted': {
      const allDeleted = await db.select().from(deletedAccounts)
      if (allDeleted.length === 0) {
        console.log('No deleted accounts.')
      } else {
        for (const d of allDeleted) {
          console.log(
            `  hash:${d.appleIdHash.slice(0, 12)}...  ` +
            `cooldown:${d.cooldownUntil.toISOString()}  ` +
            `strikes:${d.strikeCount}  ` +
            `suspension:${d.suspensionUntil?.toISOString() ?? 'null'}`
          )
        }
      }
      break
    }

    case 'clear-cooldown': {
      await db.execute(sql`UPDATE deleted_accounts SET cooldown_until = NOW() - INTERVAL '1 second'`)
      console.log('Cleared all cooldown_until in deleted_accounts')
      break
    }

    case 'clear-all': {
      await db.delete(reports)
      await db.delete(deliveryLog)
      await db.delete(deletedAccounts)
      await db.delete(blockedSenders)
      await db.delete(messages)
      await db.delete(dailyTokens)
      await db.delete(sessions)
      await db.delete(users)
      console.log('Cleared all tables.')
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
