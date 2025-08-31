/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserSessionsIndexes1756715200000 {
    name = 'AddUserSessionsIndexes1756715200000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_cleanup" ON "user_sessions" ("isActive", "expiresAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_active_lastused" ON "user_sessions" ("isActive", "lastUsedAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_risk_user_time" ON "user_sessions" ("userId", "createdAt", "lastUsedAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_risk_device" ON "user_sessions" ("deviceId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_risk_signin" ON "user_sessions" ("signInId", "userId") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_risk_user_device" ON "user_sessions" ("userId", "deviceId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_ip_gin" ON "user_sessions" USING gin ("ip") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_ip_gin"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_risk_user_device"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_risk_signin"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_risk_device"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_risk_user_time"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_active_lastused"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_cleanup"`);
    }
}
