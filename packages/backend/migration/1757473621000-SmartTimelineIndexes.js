/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class SmartTimelineIndexes1757473621000 {
	name = 'SmartTimelineIndexes1757473621000';

    async up(queryRunner) {
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_visibility_id_desc"
			ON "note" ("visibility", "id" DESC)
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_user_status_host"
			ON "user" ("isSuspended", "isDeleted", "host")
			WHERE "isSuspended" = false AND "isDeleted" = false;
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_reaction_noteid"
			ON "note_reaction" ("noteId", "id");
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_renote_id"
			ON "note" ("renoteId", "id")
			WHERE "renoteId" IS NOT NULL;
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_reply_id"
			ON "note" ("replyId", "id")
			WHERE "replyId" IS NOT NULL;
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_userid_visibility_id"
			ON "note" ("userId", "visibility", "id" DESC)
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_userid_id_time"
			ON "note" ("userId", "id" DESC, "visibility")
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_home_timeline_batch"
			ON "note" ("userId", "id" DESC)
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_global_timeline"
			ON "note" ("id" DESC, "visibility")
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_local_timeline"
			ON "note" ("id" DESC, "visibility", "uri", "localOnly")
			WHERE "visibility" = 'public' AND "uri" IS NULL AND ("localOnly" = false OR "localOnly" IS NULL);
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_historical_range"
			ON "note" ("id", "visibility", "userId")
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_historical_time_range"
			ON "note" ("visibility", "id")
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_note_discovery_time"
			ON "note" ("id" DESC, "visibility", "userId")
			WHERE "visibility" = 'public';
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_user_interaction_user_target"
			ON "user_interaction_history" ("userId", "targetId", "targetType", "createdAt" DESC);
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_user_interaction_user_time"
			ON "user_interaction_history" ("userId", "createdAt" DESC, "interactionType");
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_user_interaction_time_filter"
			ON "user_interaction_history" ("userId", "createdAt" DESC, "interactionType")
			WHERE "interactionType" IN ('like', 'renote', 'reply', 'view');
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_following_follower"
			ON "following" ("followerId", "followeeId");
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_muting_muter"
			ON "muting" ("muterId", "muteeId");
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_blocking_blocker"
			ON "blocking" ("blockerId", "blockeeId");
		`);

		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "IDX_user_recommendation_profile_user"
			ON "user_recommendation_profile" ("userId");
		`);
	}

	 async down(queryRunner) {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_visibility_id_desc"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_status_host"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_reaction_noteid"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_renote_id"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_reply_id"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_userid_visibility_id"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_userid_id_time"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_home_timeline_batch"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_global_timeline"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_local_timeline"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_historical_range"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_historical_time_range"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_note_discovery_time"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_user_target"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_user_time"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_interaction_time_filter"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_following_follower"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_muting_muter"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blocking_blocker"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_recommendation_profile_user"`);
	}
}
