/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddClientIdField1755841847000 {
	name = 'AddClientIdField1755841847000';

	async up(queryRunner) {
		await queryRunner.query(`
			ALTER TABLE "app" 
			ADD COLUMN "clientId" VARCHAR(512)
		`);
		
		await queryRunner.query(`
			COMMENT ON COLUMN "app"."clientId" IS 'The OAuth client_id URL for IndieAuth compatibility.'
		`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "app" DROP COLUMN "clientId"`);
	}
}