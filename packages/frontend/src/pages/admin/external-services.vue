<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><XHeader :actions="headerActions" :tabs="headerTabs"/></template>
	<MkSpacer :contentMax="700" :marginMin="16" :marginMax="32">
		<FormSuspense :p="init">
			<div class="_gaps_m">
				<MkFolder>
					<template #label>Google Analytics<span class="_beta">{{ i18n.ts.beta }}</span></template>

					<div class="_gaps_m">
						<MkInput v-model="googleAnalyticsMeasurementId">
							<template #prefix><i class="ti ti-key"></i></template>
							<template #label>Measurement ID</template>
						</MkInput>
						<MkButton primary @click="save_googleAnalytics">Save</MkButton>
					</div>
				</MkFolder>

				<MkFolder>
					<template #label>DeepL Translation</template>

                <div class="_gaps_m">
                    <MkInput v-model="deeplAuthKey">
                        <template #prefix><i class="ti ti-key"></i></template>
                        <template #label>DeepL Auth Key</template>
                    </MkInput>
                    <MkSwitch v-model="deeplIsPro">
                        <template #label>Pro account</template>
                    </MkSwitch>
                    <MkButton primary @click="save_deepl">Save</MkButton>
                </div>
            </MkFolder>

            <MkFolder>
                <template #label>Text-To-Speech</template>
                <div class="_gaps_m">
                    <MkInput v-model="hfAuthKey">
                        <template #prefix><i class="ti ti-key"></i></template>
                        <template #label>HuggingFace Auth Key</template>
                    </MkInput>
                    <MkSwitch v-model="hfSpace">
                        <template #label>HuggingFace Space</template>
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
						  <template #label>Restricted Regions</template>

						  <div class="_gaps_m">
							  <MkInput v-model="ip2lAuthKey">
								  <template #prefix><i class="ti ti-key"></i></template>
								  <template #label>IP2Location Auth Key</template>
							  </MkInput>
							  <MkSwitch v-model="ip2lIsPro">
								  <template #label>Pro</template>
							  </MkSwitch>
								<MkTextarea v-model="banCountry">
									<template #label>Restricted regions (one per line)</template>
								</MkTextarea>
								<MkButton primary @click="addRestrictedArea">Add GDPR-compliant regions</MkButton>
								<MkTextarea v-model="exemptIP">
									<template #label>Exempt IPs (one per line)</template>
								</MkTextarea>
							  <MkButton primary @click="save_ra">Save</MkButton>
						  </div>
					  </MkFolder>
			</div>
		</FormSuspense>
    </MkSpacer>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import XHeader from './_header_.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import FormSuspense from '@/components/form/suspense.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from "@/components/MkTextarea.vue";

const deeplAuthKey = ref<string>('');
const deeplIsPro = ref<boolean>(false);
const hfAuthKey = ref<string>('');
const hfSpace = ref<boolean>(false);
const hfSpaceName = ref<string | null>(null);
const hfexampleAudioURL = ref<string | null>(null);
const hfexampleText = ref<string | null>(null);
const hfexampleLang = ref<string | null>(null);
const hfslice = ref<string | null>('Slice once every 4 sentences');
const hftopK = ref<number>(15);
const hftopP = ref<number>(100);
const hfTemperature = ref<number>(100);
const hfnrm = ref<boolean>(false);
const hfSpeedRate = ref<number>(125);
const hfdas = ref<boolean>(false);
const ip2lAuthKey = ref<string>('');
const ip2lIsPro = ref<boolean>(false);
const banCountry = ref<string>('');
const exemptIP = ref<string>('');

const googleAnalyticsMeasurementId = ref<string>('');

async function init() {
	const meta = await misskeyApi('admin/meta');
  deeplAuthKey.value = meta.deeplAuthKey ?? '';
  deeplIsPro.value = meta.deeplIsPro;
  hfAuthKey.value = meta.hfAuthKey;
	googleAnalyticsMeasurementId.value = meta.googleAnalyticsMeasurementId ?? '';
  hfSpace.value = meta.hfSpace;
  hfSpaceName.value = meta.hfSpaceName;
  hfexampleAudioURL.value = meta.hfexampleAudioURL;
  hfexampleText.value = meta.hfexampleText;
  hfexampleLang.value = meta.hfexampleLang;
  hfslice.value = meta.hfslice;
  hftopK.value = meta.hftopK;
  hftopP.value = meta.hftopP;
  hfTemperature.value = meta.hfTemperature;
  hfnrm.value = meta.hfnrm;
  hfSpeedRate.value = meta.hfSpeedRate;
  hfdas.value = meta.hfdas;
	ip2lAuthKey.value = meta.ip2lAuthKey;
	ip2lIsPro.value = meta.ip2lIsPro;
	banCountry.value = meta.banCountry.join('\n');
	exemptIP.value = meta.exemptIP.join('\n');
}

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
	const banCountryArray = banCountry.value.split('\n').map(item => item.trim()).filter(item => item);
	const exemptIPArray = exemptIP.value.split('\n').map(item => item.trim()).filter(item => item);

	os.apiWithDialog('admin/update-meta', {
		ip2lAuthKey: ip2lAuthKey.value,
		ip2lIsPro: ip2lIsPro.value,
		banCountry: banCountryArray,
		exemptIP: exemptIPArray,
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

definePageMetadata(() => ({
    title: i18n.ts.externalServices,
    icon: 'ti ti-link',
}));
</script>
