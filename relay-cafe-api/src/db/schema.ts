import { pgTable, uuid, text, boolean, timestamp, date, primaryKey, index } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  appleIdHash: text('apple_id_hash').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deviceFingerprint: text('device_fingerprint'),
})

export const dailyTokens = pgTable('daily_tokens', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  sendUsed: boolean('send_used').notNull().default(false),
  receiveUsed: boolean('receive_used').notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.date] }),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciphertext: text('ciphertext').notNull(),
  encryptedMessageKey: text('encrypted_message_key').notNull(),
  kmsKeyVersion: text('kms_key_version').notNull(),
  iv: text('iv').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  delivered: boolean('delivered').notNull().default(false),
})

export const ipEvents = pgTable('ip_events', {
  ipHash: text('ip_hash').notNull(),
  eventType: text('event_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idx: index('ip_events_ip_hash_event_type_created_at_idx')
    .on(t.ipHash, t.eventType, t.createdAt),
}))
