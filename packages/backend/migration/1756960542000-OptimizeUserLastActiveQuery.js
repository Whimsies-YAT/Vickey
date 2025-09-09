/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class OptimizeUserLastActiveQuery1756960542000 {
	constructor() {
		this.name = 'OptimizeUserLastActiveQuery1756960542000';
	}

	async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX "IDX_user_host_lastActiveDate" ON "user" ("host", "lastActiveDate") `);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_user_host_lastActiveDate"`);
	}
}
