/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AvatarBannerFixup1743129826143 {
    name = 'AvatarBannerFixup1743129826143'

    async up(queryRunner) {
        const batchSize = 1000;
        let lastId = 0;

        while (true) {
            const users = await queryRunner.query(
                `SELECT id, "avatarUrl", "bannerUrl" FROM "user"
                 WHERE id > $1
                   AND ("avatarUrl" LIKE '%url=%' OR "bannerUrl" LIKE '%url=%')
                 ORDER BY id ASC
                 LIMIT ${batchSize}`,
                [lastId]
            );

            if (users.length === 0) {
                break;
            }

            for (const user of users) {
                let newAvatar = this.processUrl(user.avatarUrl);
                let newBanner = this.processUrl(user.bannerUrl);

                if (newAvatar !== user.avatarUrl || newBanner !== user.bannerUrl) {
                    await queryRunner.query(
                        `UPDATE "user"
                         SET "avatarUrl" = $1,
                             "bannerUrl" = $2
                         WHERE id = $3`,
                        [newAvatar, newBanner, user.id]
                    );
                }
            }

            lastId = users[users.length - 1].id;
        }
    }

    processUrl(url) {
        if (!url?.includes('url=')) return url;

        const match = url.match(/url=([^&]+)/i);
        if (!match) return url;

        try {
            return decodeURIComponent(match[1]);
        } catch {
            return url;
        }
    }

    async down(queryRunner) {
        // fixup migration, no down migration
    }
}
