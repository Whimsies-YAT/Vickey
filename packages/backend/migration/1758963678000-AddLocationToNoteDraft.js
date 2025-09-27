/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddLocationToNoteDraft1758963678000 {
    constructor() {
        this.name = 'AddLocationToNoteDraft1758963678000';
    }

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "note_draft" ADD "geojson" jsonb`);
        await queryRunner.query(`ALTER TABLE "note_draft" ADD "location" geometry`);
        await queryRunner.query(`CREATE INDEX "IDX_note_draft_location" ON "note_draft" USING GiST ("location")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_note_draft_location"`);
        await queryRunner.query(`ALTER TABLE "note_draft" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "note_draft" DROP COLUMN "geojson"`);
    }
}