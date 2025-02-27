/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class AbuseReportEnhance1738199565000 {
	name = 'AbuseReportEnhance1738199565000'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "abuse_note_autocheck" ("id" character varying(32) NOT NULL PRIMARY KEY, "detail" jsonb NOT NULL DEFAULT '{}'::jsonb, "score" numeric NOT NULL, "ignore" boolean NOT NULL DEFAULT false)`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" ADD "status" integer NOT NULL DEFAULT 0`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" ADD "targetId" character varying(128)`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" ADD "type" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseReportMLAction" character varying(64) NOT NULL DEFAULT 'record'`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLCheck" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLInfo" jsonb NOT NULL DEFAULT '{}'::jsonb`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "abuse_note_autocheck" DROP COLUMN "id"`);
		await queryRunner.query(`ALTER TABLE "abuse_note_autocheck" DROP COLUMN "detail"`);
		await queryRunner.query(`ALTER TABLE "abuse_note_autocheck" DROP COLUMN "score"`);
		await queryRunner.query(`ALTER TABLE "abuse_note_autocheck" DROP COLUMN "ignore"`);
		await queryRunner.query(`DROP TABLE "abuse_note_autocheck"`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" DROP COLUMN "status"`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" DROP COLUMN "targetId"`);
		await queryRunner.query(`ALTER TABLE "abuse_user_report" DROP COLUMN "type"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseReportMLAction"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLCheck"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLInfo"`);
	}
}
