/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddOAuthAppFields1755841746815 {
    name = 'AddOAuthAppFields1755841746815'

    async up(queryRunner) {
        // Add new fields to the app table for OAuth applications
        await queryRunner.query(`
            ALTER TABLE "app" 
            ADD COLUMN "isOAuth" BOOLEAN NOT NULL DEFAULT false
        `);
        
        await queryRunner.query(`
            ALTER TABLE "app" 
            ADD COLUMN "iconUrl" VARCHAR(512)
        `);
        
        await queryRunner.query(`
            ALTER TABLE "app" 
            ADD COLUMN "websiteUrl" VARCHAR(512)
        `);
        
        await queryRunner.query(`
            ALTER TABLE "app" 
            ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        `);

        // Add indexes for OAuth app queries
        await queryRunner.query(`
            CREATE INDEX "idx_app_user_oauth" 
            ON "app" ("userId", "isOAuth") 
            WHERE "userId" IS NOT NULL
        `);
        
        await queryRunner.query(`
            CREATE INDEX "idx_app_oauth_created" 
            ON "app" ("isOAuth", "createdAt" DESC) 
            WHERE "isOAuth" = true
        `);
    }

    async down(queryRunner) {
        // Remove indexes
        await queryRunner.query(`DROP INDEX "idx_app_oauth_created"`);
        await queryRunner.query(`DROP INDEX "idx_app_user_oauth"`);
        
        // Remove columns
        await queryRunner.query(`ALTER TABLE "app" DROP COLUMN "createdAt"`);
        await queryRunner.query(`ALTER TABLE "app" DROP COLUMN "websiteUrl"`);
        await queryRunner.query(`ALTER TABLE "app" DROP COLUMN "iconUrl"`);
        await queryRunner.query(`ALTER TABLE "app" DROP COLUMN "isOAuth"`);
    }
}