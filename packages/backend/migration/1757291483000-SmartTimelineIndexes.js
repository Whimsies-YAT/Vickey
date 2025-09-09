/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class SmartTimelineIndexes1757291483000 {
    name = 'SmartTimelineIndexes1757291483000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX "IDX_note_visibility_timeline" ON "note" ("visibility", "id") WHERE "visibility" = 'public'`);
		await queryRunner.query(`CREATE INDEX "IDX_note_local_public" ON "note" ("id", "visibility", "uri") WHERE "uri" IS NULL AND "visibility" = 'public'`);
		await queryRunner.query(`CREATE INDEX "IDX_note_reaction_noteid_engagement" ON "note_reaction" ("noteId")`);
		await queryRunner.query(`CREATE INDEX "IDX_note_renote_aggregation" ON "note" ("renoteId") WHERE "renoteId" IS NOT NULL`);
		await queryRunner.query(`CREATE INDEX "IDX_note_reply_aggregation" ON "note" ("replyId") WHERE "replyId" IS NOT NULL`);
		await queryRunner.query(`CREATE INDEX "IDX_note_user_visibility_timeline" ON "note" ("userId", "visibility", "id") WHERE "visibility" = 'public'`);
        await queryRunner.query(`CREATE INDEX "IDX_user_status_local" ON "user" ("host", "isSuspended", "isDeleted") WHERE "host" IS NULL`);
	}

	async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_user_status_local"`);
		await queryRunner.query(`DROP INDEX "IDX_note_user_visibility_timeline"`);
		await queryRunner.query(`DROP INDEX "IDX_note_reply_aggregation"`);
		await queryRunner.query(`DROP INDEX "IDX_note_renote_aggregation"`);
		await queryRunner.query(`DROP INDEX "IDX_note_reaction_noteid_engagement"`);
		await queryRunner.query(`DROP INDEX "IDX_note_local_public"`);
		await queryRunner.query(`DROP INDEX "IDX_note_visibility_timeline"`);
	}
}
