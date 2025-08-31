/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CreateUserSessions1755023049087 {
    name = 'CreateUserSessions1755023049087'

    async up(queryRunner) {
        await queryRunner.query(`
            CREATE TABLE "user_sessions" (
                "id" VARCHAR(32) PRIMARY KEY,
                "userId" VARCHAR(32) NOT NULL,
                "token" VARCHAR NOT NULL,
                "deviceId" VARCHAR(32) NOT NULL,
                "signInId" VARCHAR(32),
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
                "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "isActive" BOOLEAN NOT NULL DEFAULT true
            )
        `);

        await queryRunner.query(`
            CREATE FUNCTION set_expires_and_status() RETURNS trigger AS $$
            DECLARE
                now_timestamp TIMESTAMPTZ := NOW();
                calculated_expires_at TIMESTAMPTZ;
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NEW."lastUsedAt" IS NOT NULL THEN
                        calculated_expires_at := NEW."lastUsedAt" + interval '1 month';
                    ELSE
                      calculated_expires_at := now_timestamp + interval '1 month';
                    END IF;
                    NEW."expiresAt" := calculated_expires_at;
                    NEW."isActive" := (calculated_expires_at >= now_timestamp);
                END IF;

                IF TG_OP = 'UPDATE' AND NEW."lastUsedAt" IS DISTINCT FROM OLD."lastUsedAt" THEN
                    IF NEW."lastUsedAt" IS NOT NULL THEN
                        calculated_expires_at := NEW."lastUsedAt" + interval '1 month';
                    ELSE
                        calculated_expires_at := now_timestamp + interval '1 month';
                    END IF;
                    NEW."expiresAt" := calculated_expires_at;
                    NEW."isActive" := (calculated_expires_at >= now_timestamp);
                ELSE
                    -- For UPDATE operations that don't change lastUsedAt, just check current expiresAt
                    NEW."isActive" := (NEW."expiresAt" >= now_timestamp);
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await queryRunner.query(`
            CREATE TRIGGER trg_set_expires_and_status
            BEFORE INSERT OR UPDATE ON "user_sessions"
            FOR EACH ROW
            EXECUTE FUNCTION set_expires_and_status();
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_user_sessions_token"
            ON "user_sessions" ("token")
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_user_sessions_user_token"
            ON "user_sessions" ("userId", "token")
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_user_sessions_user_active"
            ON "user_sessions" ("userId")
            WHERE "isActive" = true
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_user_sessions_expires_at"
            ON "user_sessions" ("expiresAt")
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_user_sessions_user_active_lastused"
            ON "user_sessions" ("userId", "lastUsedAt" DESC)
            INCLUDE ("deviceId", "token", "signInId")
            WHERE "isActive" = true
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_user_sessions_active_expires"
            ON "user_sessions" ("isActive", "expiresAt")
        `);

        await queryRunner.query(`
            CREATE INDEX idx_user_sessions_user_valid_device
            ON "user_sessions" ("userId", "deviceId", "signInId");
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX idx_user_sessions_token_active_cover
            ON "user_sessions" ("token")
            INCLUDE ("userId", "lastUsedAt", "expiresAt", "isActive")
            WHERE "isActive" = true;
        `)
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "idx_user_sessions_token_active_cover"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_user_valid_device"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_active_expires"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_user_active_lastused"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_expires_at"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_user_active"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_user_token"`);
        await queryRunner.query(`DROP INDEX "idx_user_sessions_token"`);
        await queryRunner.query(`DROP TRIGGER trg_set_expires_and_status ON "user_sessions"`);
        await queryRunner.query(`DROP FUNCTION set_expires_and_status`);
        await queryRunner.query(`DROP TABLE "user_sessions"`);
    }
}
