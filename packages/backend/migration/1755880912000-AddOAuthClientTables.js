/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddOAuthClientTables1755880912000 {
	name = 'AddOAuthClientTables1755880912000';

	 async up(queryRunner) {
		await queryRunner.query(`
			CREATE TABLE "oauth_client_config" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"name" character varying(128) NOT NULL,
				"type" character varying(10) NOT NULL DEFAULT 'oauth2',
				"clientId" character varying(256) NOT NULL,
				"clientSecret" character varying(512) NOT NULL,
				"authorizationEndpoint" character varying(512) NOT NULL,
				"tokenEndpoint" character varying(512) NOT NULL,
				"userInfoEndpoint" character varying(512),
				"issuer" character varying(512),
				"jwksUri" character varying(512),
				"scope" text NOT NULL DEFAULT '',
				"redirectUri" character varying(512) NOT NULL,
				"autoRegister" boolean NOT NULL DEFAULT false,
				"autoUpdate" boolean NOT NULL DEFAULT true,
				"userMapping" jsonb NOT NULL DEFAULT '{}',
				"isActive" boolean NOT NULL DEFAULT true,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT "PK_oauth_client_config_id" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "user_session" (
				"id" character varying(32) NOT NULL,
				"userId" character varying(32) NOT NULL,
				"providerId" character varying(128) NOT NULL,
				"providerName" character varying(128) NOT NULL,
				"userInfo" jsonb NOT NULL,
				"idTokenClaims" jsonb,
				"accessToken" character varying(1024),
				"refreshToken" character varying(1024),
				"tokenExpiresAt" TIMESTAMP WITH TIME ZONE,
				"ipAddress" character varying(256),
				"userAgent" character varying(500),
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"lastUsedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT "PK_user_session_id" PRIMARY KEY ("id")
			)
		`);
        await queryRunner.query(`ALTER TABLE "user_session" ADD CONSTRAINT "FK_user_session_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`);
		await queryRunner.query(`CREATE INDEX "IDX_oauth_client_config_userId" ON "oauth_client_config" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_session_userId" ON "user_session" ("userId")`);
		await queryRunner.query(`CREATE INDEX "IDX_user_session_providerId" ON "user_session" ("providerId")`);
		await queryRunner.query(`
			ALTER TABLE "oauth_client_config"
			ADD CONSTRAINT "FK_oauth_client_config_userId"
			FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
		`);
		await queryRunner.query(`
			ALTER TABLE "user_session"
			ADD CONSTRAINT "FK_user_session_userId"
			FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
		`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "ssoProviderId" character varying(128)`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "ssoId" character varying(256)`);
		await queryRunner.query(`CREATE INDEX "IDX_user_profile_sso" ON "user_profile" ("ssoProviderId", "ssoId")`);
	}

    async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_user_profile_sso"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "ssoId"`);
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "ssoProviderId"`);
		await queryRunner.query(`ALTER TABLE "user_session" DROP CONSTRAINT "FK_user_session_userId"`);
		await queryRunner.query(`ALTER TABLE "oauth_client_config" DROP CONSTRAINT "FK_oauth_client_config_userId"`);
		await queryRunner.query(`DROP INDEX "IDX_user_session_providerId"`);
		await queryRunner.query(`DROP INDEX "IDX_user_session_userId"`);
		await queryRunner.query(`DROP INDEX "IDX_oauth_client_config_userId"`);
        await queryRunner.query(`ALTER TABLE "user_session" DROP CONSTRAINT "FK_user_session_user"`);
		await queryRunner.query(`DROP TABLE "user_session"`);
		await queryRunner.query(`DROP TABLE "oauth_client_config"`);
	}
}
