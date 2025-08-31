<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/external-services" :label="i18n.ts.externalServices" :keywords="['external', 'services', 'thirdparty']" icon="ti ti-link">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>Google Analytics</SearchLabel><span class="_beta">{{ i18n.ts.beta }}</span></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="googleAnalyticsMeasurementId">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Measurement ID</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<MkButton primary @click="save_googleAnalytics">Save</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>DeepL Translation</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="deeplAuthKey">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Auth Key</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="deeplIsPro">
									<template #label><SearchLabel>Pro account</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>

							<MkButton primary @click="save_deepl">Save</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>
			</div>
			<MkFolder>
				<template #label><SearchLabel>Text-To-Speech</SearchLabel></template>
				<div class="_gaps_m">
					<MkInput v-model="hfAuthKey">
						<template #prefix><i class="ti ti-key"></i></template>
						<template #label><SearchLabel>HuggingFace Auth Key</SearchLabel></template>
					</MkInput>
					<MkSwitch v-model="hfSpace">
						<template #label><SearchLabel>HuggingFace Space</SearchLabel></template>
					</MkSwitch>
					<div v-if="hfSpace">
						<MkInput v-model="hfSpaceName">
							<template #label>Space Name</template>
						</MkInput>
						<MkInput v-model="hfexampleAudioURL">
							<template #label>Example Audio URL</template>
						</MkInput>
						<br />
						<MkSwitch v-model="hfnrm">
							<template #label>Enable no reference mode</template>
						</MkSwitch>
						<br />
						<div v-if="!hfnrm">
							<MkInput v-model="hfexampleText">
								<template #label>Example Text</template>
							</MkInput>
						</div>
						<MkSelect v-model="hfexampleLang">
							<template #label>Example Language</template>
							<option value="" disabled> </option>
							<option value="Chinese">中文</option>
							<option value="English">English</option>
							<option value="Japanese">日本語</option>
							<option value="Yue">中文 (粤语)</option>
							<option value="Korean">한국어</option>
							<option value="Chinese-English Mixed">中文 - English</option>
							<option value="Japanese-English Mixed">日本語 - English</option>
							<option value="Yue-English Mixed">中文 (粤语) - English</option>
							<option value="Korean-English Mixed">한국어 - English</option>
							<option value="Multilingual Mixed">Multilingual Mixed</option>
							<option value="Multilingual Mixed(Yue)">Multilingual Mixed (Yue)</option>
						</MkSelect>
						<br />
						<MkSwitch v-model="hfdas">
							<template #label>Whether to directly adjust the speech rate and timebre of the last synthesis result to prevent randomness</template>
						</MkSwitch>
						<br />
						<MkSelect v-model="hfslice">
							<template #label>Slice</template>
							<option value="" disabled> </option>
							<option value="No slice">No slice</option>
							<option value="Slice once every 4 sentences">Slice once every 4 sentences</option>
							<option value="Slice per 50 characters">Slice per 50 characters</option>
							<option value="Slice by Chinese punct">Slice by Chinese punct</option>
							<option value="Slice by English punct">Slice by English punct</option>
							<option value="Slice by every punct">Slice by every punct</option>
						</MkSelect>
						<MkInput v-model.number="hftopK" type="range" :min="0" :max="100" :step="1">
							<template #label>Set top_k Value: {{ hftopK }}</template>
						</MkInput>
						<MkInput v-model.number="hftopP" type="range" :min="0" :max="100" :step="5">
							<template #label>Set top_p Value: {{ hftopP }}</template>
						</MkInput>
						<MkInput v-model.number="hfTemperature" type="range" :min="0" :max="100" :step="5">
							<template #label>Set Temperature Value: {{ hfTemperature }}</template>
						</MkInput>
						<MkInput v-model.number="hfSpeedRate" type="range" :min="60" :max="165" :step="5">
							<template #label>Set Speed Rate Value: {{ hfSpeedRate }}</template>
						</MkInput>
					</div>
					<MkButton primary @click="save_tts">Save</MkButton>
				</div>
			</MkFolder>

			<MkFolder>
				<template #label><SearchLabel>Restricted Regions</SearchLabel></template>

				<div class="_gaps_m">
					<MkInput v-model="ip2lAuthKey">
						<template #prefix><i class="ti ti-key"></i></template>
						<template #label><SearchLabel>IP2Location Auth Key</SearchLabel></template>
					</MkInput>
					<MkSwitch v-model="ip2lIsPro">
						<template #label><SearchLabel>IP2Location Pro</SearchLabel></template>
					</MkSwitch>
					<MkTextarea v-model="banCountry">
						<template #label><SearchLabel>Restricted regions (one per line)</SearchLabel></template>
					</MkTextarea>
					<MkButton primary @click="addRestrictedArea">Add GDPR-compliant regions</MkButton>
					<MkTextarea v-model="exemptIP">
						<template #label><SearchLabel>Exempt IPs (one per line)</SearchLabel></template>
					</MkTextarea>
					<MkButton primary @click="save_ra">Save</MkButton>
				</div>
			</MkFolder>

			<MkFolder>
				<template #label>Proxy Database</template>

				<div class="_gaps_m">
					<MkInput v-model="ip2lProxyAuthKey">
						<template #prefix><i class="ti ti-key"></i></template>
						<template #label><SearchLabel>IP2Proxy Auth Key</SearchLabel></template>
					</MkInput>
					<MkSwitch v-model="ip2lProxyIsPro">
						<template #label><SearchLabel>IP2Proxy Pro</SearchLabel></template>
					</MkSwitch>
					<MkButton primary @click="save_pd">Save</MkButton>
				</div>
			</MkFolder>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from "@/components/MkTextarea.vue";

const meta = await misskeyApi('admin/meta');

const deeplAuthKey = ref(meta.deeplAuthKey ?? '');
const deeplIsPro = ref(meta.deeplIsPro);
const googleAnalyticsMeasurementId = ref(meta.googleAnalyticsMeasurementId ?? '');
const hfAuthKey = ref(meta.hfAuthKey ?? '');
const hfSpace = ref(meta.hfSpace ?? false);
const hfSpaceName = ref(meta.hfSpaceName ?? null);
const hfexampleAudioURL = ref(meta.hfexampleAudioURL ?? null);
const hfexampleText = ref(meta.hfexampleText ?? null);
const hfexampleLang = ref(meta.hfexampleLang ?? null);
const hfslice = ref(meta.hfslice ?? 'Slice once every 4 sentences');
const hftopK = ref(meta.hftopK ?? 15);
const hftopP = ref(meta.hftopP ?? 100);
const hfTemperature = ref(meta.hfTemperature ?? 100);
const hfnrm = ref(meta.hfnrm ?? false);
const hfSpeedRate = ref(meta.hfSpeedRate ?? 125);
const hfdas = ref(meta.hfdas ?? false);
const ip2lAuthKey = ref(meta.ip2lAuthKey ?? '');
const ip2lIsPro = ref(meta.ip2lIsPro ?? false);
const banCountry = ref(meta.banCountry ?? '');
const exemptIP = ref(meta.exemptIP ?? '');
const ip2lProxyAuthKey = ref(meta.ip2lProxyAuthKey ?? '');
const ip2lProxyIsPro = ref(meta.ip2lProxyIsPro ?? false);

function save_deepl() {
    os.apiWithDialog('admin/update-meta', {
        deeplAuthKey: deeplAuthKey.value,
        deeplIsPro: deeplIsPro.value,
    }).then(() => {
        fetchInstance(true);
    });
}

function save_tts() {
    os.apiWithDialog('admin/update-meta', {
        hfAuthKey: hfAuthKey.value,
        hfSpace: hfSpace.value,
        hfSpaceName: hfSpaceName.value,
        hfexampleAudioURL: hfexampleAudioURL.value,
        hfexampleText: hfexampleText.value,
        hfexampleLang: hfexampleLang.value,
        hfslice: hfslice.value,
        hftopK: hftopK.value,
        hftopP: hftopP.value,
        hfTemperature: hfTemperature.value,
        hfnrm: hfnrm.value,
        hfSpeedRate: hfSpeedRate.value,
        hfdas: hfdas.value,
    }).then(() => {
        fetchInstance(true);
    });
}

function save_googleAnalytics() {
	os.apiWithDialog('admin/update-meta', {
		googleAnalyticsMeasurementId: googleAnalyticsMeasurementId.value,
	}).then(() => {
		fetchInstance(true);
	});
}

function save_ra() {
	const banCountryArray = String(banCountry.value || '').split('\n').map(item => item.trim()).filter(item => item);
	const exemptIPArray = String(exemptIP.value || '').split('\n').map(item => item.trim()).filter(item => item);

	os.apiWithDialog('admin/update-meta', {
		ip2lAuthKey: ip2lAuthKey.value,
		ip2lIsPro: ip2lIsPro.value,
		banCountry: banCountryArray,
		exemptIP: exemptIPArray,
	}).then(() => {
		fetchInstance(true);
	});
}

function save_pd() {
	os.apiWithDialog('admin/update-meta', {
		ip2lProxyAuthKey: ip2lProxyAuthKey.value,
		ip2lProxyIsPro: ip2lProxyIsPro.value,
	}).then(() => {
		fetchInstance(true);
	});
}

function addRestrictedArea() {
	const gdprRegions = [
		'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
		'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
		'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'NO', 'LI',
		'CH', 'MK', 'AL', 'RS', 'ME', 'XK', 'BA', 'TR'
	];

	const newArea = gdprRegions.join('\n') + '\n';

	banCountry.value = newArea + banCountry.value;
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.externalServices,
	icon: 'ti ti-link',
}));
</script>
