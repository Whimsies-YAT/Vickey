/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class FixUserSessionTable1755880913000 {
	name = 'FixUserSessionTable1755880913000';

    async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_session_userId" ON "user_session" ("userId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_session_providerId" ON "user_session" ("providerId")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_session_tokenExpiresAt" ON "user_session" ("tokenExpiresAt")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_session_userId_createdAt" ON "user_session" ("userId", "createdAt")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_session_providerId_createdAt" ON "user_session" ("providerId", "createdAt")`);
	}

    async down(queryRunner) {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_session_providerId_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_session_userId_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_session_tokenExpiresAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_session_providerId"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_session_userId"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "user_session"`);
	}
}
