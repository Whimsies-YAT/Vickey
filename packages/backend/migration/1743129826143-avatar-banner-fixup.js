/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class AvatarBannerFixup1743129826143 {
    name = 'AvatarBannerFixup1743129826143'

    async up(queryRunner) {
			await queryRunner.query(`CREATE OR REPLACE FUNCTION url_decode(input TEXT) RETURNS TEXT AS $$
				DECLARE
    			result TEXT := '';
			    i INT := 1;
    			len INT := length(input);
    			hex TEXT;
    			decoded_char CHAR(1);
				BEGIN
    			WHILE i <= len LOOP
      			IF substring(input FROM i FOR 1) = '%' AND i + 2 <= len THEN
          	  hex := substring(input FROM i + 1 FOR 2);
          	  decoded_char := chr(('x' || hex)::bit(8)::int);
            	result := result || decoded_char;
            	i := i + 3;
        		ELSE
          	  result := result || substring(input FROM i FOR 1);
            	i := i + 1;
        		END IF;
    			END LOOP;
    			RETURN result;
				EXCEPTION
    			WHEN others THEN
        	RETURN input;
				END;
				$$ LANGUAGE plpgsql IMMUTABLE;`)
			await queryRunner.query(`UPDATE "user"
        SET "avatarUrl" =
            CASE
                WHEN "avatarUrl" LIKE '%url=%' THEN
									url_decode(
										substring("avatarUrl" FROM 'url=([^&]+)')
									)
                ELSE "avatarUrl"
            END
        WHERE "avatarUrl" LIKE '%url=%';
    `);
			await queryRunner.query(`UPDATE "user"
        SET "bannerUrl" =
            CASE
                WHEN "bannerUrl" LIKE '%url=%' THEN
									url_decode(
										substring("bannerUrl" FROM 'url=([^&]+)')
									)
                ELSE "bannerUrl"
            END
        WHERE "bannerUrl" LIKE '%url=%';
    `);
		}

    async down(queryRunner) {
        // fixup migration, no down migration
    }
}
