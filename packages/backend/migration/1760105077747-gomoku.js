/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class Gomoku1760105077747 {
	name = 'Gomoku1760105077747'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "gomoku_game" ("id" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "user1Id" character varying(32) NOT NULL, "user2Id" character varying(32) NOT NULL, "user1Ready" boolean NOT NULL DEFAULT false, "user2Ready" boolean NOT NULL DEFAULT false, "black" integer, "isStarted" boolean NOT NULL DEFAULT false, "isEnded" boolean NOT NULL DEFAULT false, "winnerId" character varying(32), "surrenderedUserId" character varying(32), "board" jsonb NOT NULL DEFAULT '[]', "logs" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_gomoku_game_id" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_gomoku_game_user1Id" ON "gomoku_game" ("user1Id") `);
		await queryRunner.query(`CREATE INDEX "IDX_gomoku_game_user2Id" ON "gomoku_game" ("user2Id") `);
		await queryRunner.query(`ALTER TABLE "gomoku_game" ADD CONSTRAINT "FK_gomoku_game_user1Id" FOREIGN KEY ("user1Id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "gomoku_game" ADD CONSTRAINT "FK_gomoku_game_user2Id" FOREIGN KEY ("user2Id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "gomoku_game" DROP CONSTRAINT "FK_gomoku_game_user2Id"`);
		await queryRunner.query(`ALTER TABLE "gomoku_game" DROP CONSTRAINT "FK_gomoku_game_user1Id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_gomoku_game_user2Id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_gomoku_game_user1Id"`);
		await queryRunner.query(`DROP TABLE "gomoku_game"`);
	}
}
