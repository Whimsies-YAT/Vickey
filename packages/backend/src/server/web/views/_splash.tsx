/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function Splash(props: {
	icon?: string | null;
}) {
	return (
		<div id="splash">
			<img id="splashIcon" src={props.icon || '/static-assets/splash.png'} />
			<div id="splashSpinner">
				<svg class="spinner bg" viewBox="0 0 152 152" xmlns="http://www.w3.org/2000/svg">
					<circle cx="76" cy="76" r="64" style="fill:none;stroke:currentColor;stroke-width:24px;"/>
				</svg>
				<svg class="spinner fg" viewBox="0 0 152 152" xmlns="http://www.w3.org/2000/svg">
					<circle cx="76" cy="76" r="64" style="fill:none;stroke:currentColor;stroke-width:24px;"/>
				</svg>
			</div>
		</div>
	);
}
