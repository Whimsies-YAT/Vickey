/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class Werewolf1760498868000 {
	name = 'Werewolf1760498868000'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "werewolf_game" ("id" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "hostId" character varying(32) NOT NULL, "isStarted" boolean NOT NULL DEFAULT false, "isEnded" boolean NOT NULL DEFAULT false, "config" jsonb NOT NULL, "phase" character varying(16) NOT NULL DEFAULT 'waiting', "subPhase" character varying(32), "dayNumber" integer NOT NULL DEFAULT 0, "players" jsonb NOT NULL DEFAULT '[]', "winnerTeam" character varying(32), "logs" jsonb NOT NULL DEFAULT '[]', "currentActions" jsonb NOT NULL DEFAULT '{}', "voiceAppId" character varying(64), "voiceAppSecret" character varying(128), "voiceSessionId" character varying(128), "phaseStartedAt" TIMESTAMP WITH TIME ZONE, "phaseEndsAt" TIMESTAMP WITH TIME ZONE, "currentSpeaker" character varying(32), "speakerStartTime" TIMESTAMP WITH TIME ZONE, "speechOrder" jsonb, "currentSpeechIndex" integer, "nightKillTarget" character varying(32), "testamentQueue" jsonb, "currentTestamentIndex" integer, "seats" jsonb NOT NULL DEFAULT '[]', "speechTimeRemaining" integer, "speechTimeoutAt" TIMESTAMP WITH TIME ZONE, "readyPlayers" jsonb NOT NULL DEFAULT '[]', "isCountingDown" boolean NOT NULL DEFAULT false, "countdownStartedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_werewolf_game_id" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_werewolf_game_hostId" ON "werewolf_game" ("hostId") `);
		await queryRunner.query(`CREATE INDEX "IDX_werewolf_game_phase" ON "werewolf_game" ("phase") `);
		await queryRunner.query(`CREATE INDEX "IDX_werewolf_game_isEnded" ON "werewolf_game" ("isEnded") `);
		await queryRunner.query(`ALTER TABLE "werewolf_game" ADD CONSTRAINT "FK_werewolf_game_hostId" FOREIGN KEY ("hostId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "werewolf_game" DROP CONSTRAINT "FK_werewolf_game_hostId"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_werewolf_game_isEnded"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_werewolf_game_phase"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_werewolf_game_hostId"`);
		await queryRunner.query(`DROP TABLE "werewolf_game"`);
	}
}