/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CommonProps } from '@/server/web/views/_.js';
import { Layout } from '@/server/web/views/base.js';

export function OAuthPage(props: CommonProps<{
	transactionId: string;
	clientName: string;
	clientLogo?: string;
	clientDescription?: string;
	clientWebsiteUrl?: string | null;
	scope: string[];
}>) {
	//- Should be removed by the page when it loads, so that it won't needlessly
	//- stay when user navigates away via the navigation bar
	//- XXX: Remove navigation bar in auth page?
	function metaBlock() {
		return (
			<>
				<meta name="misskey:oauth:transaction-id" content={props.transactionId} />
				<meta name="misskey:oauth:client-name" content={props.clientName} />
				{props.clientLogo ? <meta name="misskey:oauth:client-logo" content={props.clientLogo} /> : null}
				{props.clientDescription ? <meta name="misskey:oauth:client-description" content={props.clientDescription} /> : null}
				{props.clientWebsiteUrl ? <meta name="misskey:oauth:client-website-url" content={props.clientWebsiteUrl} /> : null}
				<meta name="misskey:oauth:scope" content={props.scope.join(' ')} />
			</>
		);
	}

	return (
		<Layout
			{...props}
			metaSlot={metaBlock()}
		>
		</Layout>
	);
}
