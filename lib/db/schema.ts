import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  // Invited by email; matched against the Clerk account's primary email (lowercased)
  email: text('email').notNull().unique(),
  // Clerk user id, linked on their first sign-in
  clerkId: text('clerk_id').unique(),
  role: text('role', { enum: ['admin', 'editor'] }).notNull().default('editor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sites = pgTable('sites', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Friendly name shown to editors, e.g. "Sankt Knuds Brasseri & Bar"
  name: text('name').notNull(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  workBranch: text('work_branch').notNull().default('sigtil-edits'),
  // Fine-grained GitHub PAT scoped to this single repo (contents: read/write)
  githubToken: text('github_token').notNull(),
  vercelProjectId: text('vercel_project_id').notNull(),
  vercelTeamId: text('vercel_team_id'),
  productionUrl: text('production_url').notNull(),
  // Path prefixes the agent may edit; anything else is refused
  editablePaths: jsonb('editable_paths').$type<string[]>().notNull()
    .default(['app/', 'components/', 'content/', 'lib/', 'public/', 'messages/', 'locales/', 'data/']),
  // Free-text notes injected into the system prompt, e.g. "menu lives in lib/menu.ts"
  siteNotes: text('site_notes').notNull().default(''),
  // Kroner the AI may cost this site in a month; the chat waits for the next month once it is spent
  monthlyBudgetDkk: integer('monthly_budget_dkk').notNull().default(70),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const siteMembers = pgTable('site_members', {
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.siteId, t.userId] })]);

// One running conversation per editor and site, as AI SDK UI messages, so a
// visit picks up where the last one left off. Trimmed in lib/chat.ts.
export const chats = pgTable('chats', {
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.siteId, t.userId] })]);

// What the AI has cost each site, one row per site and month ("2026-11"), in
// dollars as the model provider bills it. Shown to editors in lib/budget.ts.
export const usage = pgTable('usage', {
  siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
}, t => [primaryKey({ columns: [t.siteId, t.month] })]);

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
