/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class MLMetaEnhance1739791718000 {
	name = 'MLMetaEnhance1739791718000'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLInfo"`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLInfoUrl" character varying(512)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLInfoToken" character varying(8192)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLInfoScore" numeric NOT NULL DEFAULT 0.5`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "abuseMLInfo" jsonb NOT NULL DEFAULT '{}'::jsonb`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLInfoUrl"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLInfoToken"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "abuseMLInfoScore"`);
	}
}
