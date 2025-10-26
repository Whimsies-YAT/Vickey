/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class WerewolfTiedVoting1760784245229 {
	name = 'WerewolfTiedVoting1760784245229'

	async up(queryRunner) {
		// Add fields for tied voting mechanism
		await queryRunner.query(`ALTER TABLE "werewolf_game" ADD "tiedPlayers" jsonb DEFAULT '[]'`);
		await queryRunner.query(`ALTER TABLE "werewolf_game" ADD "votingRound" integer DEFAULT 1`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "werewolf_game" DROP COLUMN "votingRound"`);
		await queryRunner.query(`ALTER TABLE "werewolf_game" DROP COLUMN "tiedPlayers"`);
	}
}