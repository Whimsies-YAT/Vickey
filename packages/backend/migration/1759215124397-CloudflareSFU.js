/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CloudflareSFU1759215124397 {
	name = 'CloudflareSFU1759215124397'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "enableCloudflareSfu" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "cloudflareAccountId" varchar(1024)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "cloudflareApiToken" varchar(1024)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "cloudflareSfuAppId" varchar(1024)`);
		await queryRunner.query(`ALTER TABLE "meta" ADD "cloudflareSfuAppSecret" varchar(1024)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "cloudflareSfuAppSecret"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "cloudflareSfuAppId"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "cloudflareApiToken"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "cloudflareAccountId"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableCloudflareSfu"`);
	}
}