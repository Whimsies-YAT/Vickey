/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class addGeoShare1756368065000 {
    name = 'addGeoShare1756368065000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
        await queryRunner.query(`
            ALTER TABLE "note"
            ADD COLUMN "geojson" jsonb,
            ADD COLUMN "location" geometry(Point, 4326)
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_notes_location_gist"
            ON "note"
            USING GIST ("location")
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`
            DROP INDEX "IDX_notes_location_gist"
        `);
        await queryRunner.query(`
            ALTER TABLE "note"
            DROP COLUMN "location",
            DROP COLUMN "geojson"
        `);
        await queryRunner.query(`DROP EXTENSION IF EXISTS postgis`);
    }
}
