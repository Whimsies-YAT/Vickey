/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class OptimizeLocalUserQuery1757477938000 {
	name = 'OptimizeLocalUserQuery1757477938000';

	async up(queryRunner) {
		await queryRunner.query(`
			CREATE INDEX "IDX_user_local_lastActiveDate"
			ON "user" ("lastActiveDate" DESC)
			WHERE "host" IS NULL;
		`);

		await queryRunner.query(`
			CREATE INDEX "IDX_user_local_active_status"
			ON "user" ("lastActiveDate" DESC, "isSuspended", "isDeleted")
			WHERE "host" IS NULL AND "isSuspended" = false AND "isDeleted" = false;
		`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_user_local_active_status"`);
		await queryRunner.query(`DROP INDEX "IDX_user_local_lastActiveDate"`);
	}
}
