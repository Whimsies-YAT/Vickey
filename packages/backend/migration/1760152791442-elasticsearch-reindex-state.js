/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ElasticsearchReindexState1760152791442 {
	name = 'ElasticsearchReindexState1760152791442'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "elasticsearch_reindex_state" ("indexPattern" character varying(512) NOT NULL, "status" character varying(32) NOT NULL, "oldIndex" character varying(512), "newIndex" character varying(512), "taskId" character varying(512), "targetConfig" jsonb NOT NULL, "retryCount" integer NOT NULL DEFAULT 0, "errorMessage" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_elasticsearch_reindex_state_indexPattern" PRIMARY KEY ("indexPattern"))`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "elasticsearch_reindex_state"`);
	}
}
