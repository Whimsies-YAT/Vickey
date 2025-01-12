/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */


export class EmailTemplates1735982909000 {
	name = 'EmailTemplates1735982909000'

	async up(queryRunner) {
			await queryRunner.query(`CREATE TABLE "email_templates" ("key" character varying(1024) NOT NULL PRIMARY KEY, "content" text[] NOT NULL DEFAULT '{}', "enabled" boolean NOT NULL DEFAULT false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('newLogin', '{"New login / ログインがありました", "There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('abuseReport', '{"New Abuse Report", "\\\${comment}"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('resetPassword', '{"Password reset requested", "To reset password, please click this link:<br><a href=\\\"\\\${link}\\\">\\\${link}</a>"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountDelete', '{"Account deleted", "Your account has been deleted."}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('inactivityWarning', '{"Moderator Inactivity Warning / モデレーター不在の通知", "To Moderators,<br><br>A moderator has been inactive for a period of time. If there are \\\${timeVariant} of inactivity left, it will switch to approval only.<br>If you do not wish to move to approval only, you must log into Misskey and update your last active date and time.<br><br>---------------<br><br>To モデレーター各位<br><br>モデレーターが一定期間活動していないようです。あと\\\${timeVariantJa}活動していない状態が続くと承認制に切り替わります。<br>承認制に切り替わることを望まない場合は、Misskeyにログインして最終アクティブ日時を更新してください。<br>"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('changeToApproval', '{"Change to Approval-Only / 承認制に変更されました", "To Moderators,<br><br>Changed to approval only because no moderator activity was detected for \\\${MODERATOR_INACTIVITY_LIMIT_DAYS} days.<br>To cancel the approval only, you need to access the control panel.<br><br>---------------<br><br>To モデレーター各位<br><br>モデレーターの活動が\\\${MODERATOR_INACTIVITY_LIMIT_DAYS}日間検出されなかったため、承認制に変更されました。<br>承認制を解除するには、コントロールパネルにアクセスする必要があります。<br>"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('signup', '{"Signup", "To complete signup, please click this link:<br><a href=\\\"\\\${link}\\\">\\\${link}</a>"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('emailVerification', '{"Email verification", "To verify email, please click this link:<br><a href=\\\"\\\${link}\\\">\\\${link}</a>"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountApproved', '{"Account Approved", "Your Account has been approved. Have fun socializing!"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountSuspended', '{"Account Suspended", "Your account has been suspended. Please contact moderators for more details."}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('approvalPending', '{"Approval pending", "Congratulations! Your account is now pending approval. You will get notified when you have been accepted."}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('newUserApproval', '{"New user awaiting approval", "A new user called \\\${username} (Email: \\\${email}) is awaiting approval with the following reason: \\\"\\\${reason}\\\""}', false)`);
		  	await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('newUserApprovalWithoutEmail', '{"New user awaiting approval", "A new user called \\\${username} is awaiting approval with the following reason: \\\"\\\${reason}\\\""}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountReinstated', '{"Account Reinstated", "Your account has been reinstated. You can now access it again. If you have any further questions, please contact moderators."}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountDeclined', '{"Account declined", "Your Account has been declined!"}', false)`);
		  	await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('accountDeclinedWithReason', '{"Account declined", "Your account has been declined due to: \\\${reason}"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('newFollower', '{"You have a new follower", "\\\${name} (@\\\${username}@\\\${host})"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('newFollowRequest', '{"You have received a new follow request", "\\\${name} (@\\\${username}@\\\${host})"}', false)`);
			await queryRunner.query(`INSERT INTO "email_templates" ("key", "content", "enabled") VALUES ('secRelease', '{"New Security Release Detected", "Version \\\${tag} contains security updates!"}', false)`);
		  	await queryRunner.query(`ALTER TABLE "meta" ADD "enableEmailTemplates" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "newLogin"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "abuseReport"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "resetPassword"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountDelete"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "inactivityWarning"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "changeToApproval"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "signup"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "emailVerification"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountApproved"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountSuspended"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "approvalPending"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "newUserApproval"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "newUserApprovalWithoutEmail"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountReinstated"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountDeclined"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "accountDeclinedWithReason"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "newFollower"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "newFollowRequest"`);
		await queryRunner.query(`ALTER TABLE "email_templates" DROP COLUMN "secRelease"`);
		await queryRunner.query(`DROP TABLE "email_templates"`);
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableEmailTemplates"`);

	}
}
