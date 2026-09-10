const { sqliteTable, text, integer, primaryKey, index } = require('drizzle-orm/sqlite-core');
const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(), authId: text('auth_id').notNull().unique(), email: text('email').notNull(), name: text('name').notNull(), suburb: text('suburb').notNull(), bio: text('bio').notNull().default(''), interests: text('interests').notNull().default('[]'), ages: text('ages').notNull().default('[]'), showSuburb: integer('show_suburb').notNull().default(1), showInterests: integer('show_interests').notNull().default(1), createdAt: integer('created_at').notNull()
});
const clubs = sqliteTable('clubs', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(()=>profiles.id), name: text('name').notNull(), suburb: text('suburb').notNull(), description: text('description').notNull(), interests: text('interests').notNull().default('[]'), ages: text('ages').notNull().default('[]'), facebookUrl: text('facebook_url').notNull().default(''), color: text('color').notNull().default('blue'), createdAt: integer('created_at').notNull()
});
const memberships = sqliteTable('memberships', {clubId:text('club_id').notNull().references(()=>clubs.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),createdAt:integer('created_at').notNull()}, t=>[primaryKey({columns:[t.clubId,t.userId]}),index('memberships_user_idx').on(t.userId)]);
const posts = sqliteTable('posts', {id:text('id').primaryKey(),authorId:text('author_id').notNull().references(()=>profiles.id),clubId:text('club_id').references(()=>clubs.id,{onDelete:'cascade'}),title:text('title').notNull(),body:text('body').notNull(),topic:text('topic').notNull(),link:text('link').notNull().default(''),createdAt:integer('created_at').notNull()}, t=>[index('posts_club_time_idx').on(t.clubId,t.createdAt)]);
const replies = sqliteTable('replies', {id:text('id').primaryKey(),postId:text('post_id').notNull().references(()=>posts.id,{onDelete:'cascade'}),authorId:text('author_id').notNull().references(()=>profiles.id),body:text('body').notNull(),createdAt:integer('created_at').notNull()}, t=>[index('replies_post_time_idx').on(t.postId,t.createdAt)]);
const reactions = sqliteTable('reactions', {postId:text('post_id').notNull().references(()=>posts.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>profiles.id,{onDelete:'cascade'})},t=>[primaryKey({columns:[t.postId,t.userId]})]);
const saved = sqliteTable('saved', {userId:text('user_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),eventId:text('event_id').notNull(),eventJson:text('event_json').notNull(),createdAt:integer('created_at').notNull()},t=>[primaryKey({columns:[t.userId,t.eventId]})]);
const eventInterest = sqliteTable('event_interest', {
  userId:text('user_id').notNull().references(()=>profiles.id,{onDelete:'cascade'}),
  eventId:text('event_id').notNull(),
  eventJson:text('event_json').notNull(),
  createdAt:integer('created_at').notNull()
},t=>[primaryKey({columns:[t.userId,t.eventId]}),index('event_interest_event_idx').on(t.eventId)]);
module.exports = {profiles,clubs,memberships,posts,replies,reactions,saved,eventInterest};
