import { pgTable, uuid, text, bigint, boolean, timestamp, primaryKey, integer, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  appleIdHash: text('apple_id_hash').unique().notNull(),
  suspended: boolean('suspended').notNull().default(false),
  strikeCount: integer('strike_count').notNull().default(0),
  lastStrikeAt: timestamp('last_strike_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const dailyTokens = pgTable('daily_tokens', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: bigint('date', { mode: 'number' }).notNull(),
  sendUsed: boolean('send_used').notNull().default(false),
  receiveUsed: boolean('receive_used').notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] }),
}))

export const deletedAccounts = pgTable('deleted_accounts', {
  appleIdHash: text('apple_id_hash').primaryKey(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }).notNull(),
})

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderUserId: uuid('sender_user_id').notNull().references(() => users.id),
  ciphertext: text('ciphertext').notNull(),
  encryptedMessageKey: text('encrypted_message_key').notNull(),
  kmsKeyVersion: text('kms_key_version').notNull(),
  iv: text('iv').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  senderIdx: index('idx_messages_sender').on(t.senderUserId),
}))

export const deliveryLog = pgTable('delivery_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().unique(),
  senderUserId: uuid('sender_user_id').notNull().references(() => users.id),
  recipientUserId: uuid('recipient_user_id').notNull().references(() => users.id),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  recipientIdx: index('idx_delivery_recipient').on(t.recipientUserId),
}))

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull(),
  reporterUserId: uuid('reporter_user_id').notNull().references(() => users.id),
  senderUserId: uuid('sender_user_id').notNull().references(() => users.id),
  actionTaken: text('action_taken').notNull(),
  strikeCountAfter: integer('strike_count_after').notNull(),
  reviewed: boolean('reviewed').notNull().default(false),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueReport: index('idx_reports_unique').on(t.messageId, t.reporterUserId),
  senderIdx: index('idx_reports_sender').on(t.senderUserId),
}))

export const blockedSenders = pgTable('blocked_senders', {
  blockerUserId: uuid('blocker_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedSenderUserId: uuid('blocked_sender_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.blockerUserId, t.blockedSenderUserId] }),
  blockedIdx: index('idx_blocked_sender').on(t.blockedSenderUserId),
}))
