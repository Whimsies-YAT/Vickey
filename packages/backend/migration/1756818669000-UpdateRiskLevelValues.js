/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class UpdateRiskLevelValues1756818669000 {
    name = 'UpdateRiskLevelValues1756818669000'

    async up(queryRunner) {
        // Update existing risk levels to new naming scheme
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'poor' WHERE "riskLevel" = 'critical'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'fair' WHERE "riskLevel" = 'high'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'good' WHERE "riskLevel" = 'medium'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'veryGood' WHERE "riskLevel" = 'low'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'excellent' WHERE "riskLevel" = 'minimal'`);
        
        // Update column comment
        await queryRunner.query(`COMMENT ON COLUMN "user"."riskLevel" IS 'Risk level: poor, fair, good, veryGood, excellent'`);
    }

    async down(queryRunner) {
        // Revert to old risk levels
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'critical' WHERE "riskLevel" = 'poor'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'high' WHERE "riskLevel" = 'fair'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'medium' WHERE "riskLevel" = 'good'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'low' WHERE "riskLevel" = 'veryGood'`);
        await queryRunner.query(`UPDATE "user" SET "riskLevel" = 'minimal' WHERE "riskLevel" = 'excellent'`);
        
        // Update column comment
        await queryRunner.query(`COMMENT ON COLUMN "user"."riskLevel" IS 'Risk level: low, medium, high, critical'`);
    }
}