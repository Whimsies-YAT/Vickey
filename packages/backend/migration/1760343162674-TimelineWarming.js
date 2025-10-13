/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class TimelineWarming1760343162674 {
	name = 'TimelineWarming1760343162674'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "enableTimelineWarming" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "timelineWarmingTarget" integer NOT NULL DEFAULT 1000`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "timelineWarmingMinNotes" integer NOT NULL DEFAULT 100`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "timelineWarmingMinFollowers" integer NOT NULL DEFAULT 100`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "timelineWarmingMinFollowers"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "timelineWarmingMinNotes"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "timelineWarmingTarget"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableTimelineWarming"`);
	}
}