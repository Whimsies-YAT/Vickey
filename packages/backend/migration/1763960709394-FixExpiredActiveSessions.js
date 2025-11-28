/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class FixExpiredActiveSessions1763960709394 {
	name = 'FixExpiredActiveSessions1763960709394'

	async up(queryRunner) {
		await queryRunner.query(`
			UPDATE "user_sessions"
			SET "isActive" = false
			WHERE "isActive" = true
			AND "expiresAt" < NOW()
		`);
	}

	async down(queryRunner) {
		// This migration is essentially irreversible
	}
}