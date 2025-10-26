/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class WerewolfVoiceSessions1760599571640 {
	name = 'WerewolfVoiceSessions1760599571640'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "werewolf_game" DROP COLUMN "voiceSessionId"`);
		await queryRunner.query(`ALTER TABLE "werewolf_game" ADD "playerVoiceSessions" jsonb NOT NULL DEFAULT '{}'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "werewolf_game" DROP COLUMN "playerVoiceSessions"`);
		await queryRunner.query(`ALTER TABLE "werewolf_game" ADD "voiceSessionId" character varying(128)`);
	}
}