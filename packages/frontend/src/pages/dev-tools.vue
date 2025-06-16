<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
	<PageWithHeader>
		<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
			<div class="_gaps_m">
				<MkFolder>
					<template #label>{{ i18n.ts._devTools.timestampIdConversion }}</template>
					<div class="_gaps_m">
						<MkSelect v-model="value1" required="required">
							<template #label>{{ i18n.ts._devTools.inputType }}</template>
							<option v-for="opt in optionsForOneTIC" :key="opt.value" :value="opt.value">
								{{ opt.text }}
							</option>
						</MkSelect>

						<MkSelect v-model="value2" required="required">
							<template #label>{{ i18n.ts._devTools.outputType }}</template>
							<option v-for="opt in optionsForTwo" :key="opt.value" :value="opt.value">
								{{ opt.text }}
							</option>
						</MkSelect>

						<MkInput v-model="inputValue" type="text" required="required">
							<template #label>{{ i18n.ts._devTools.input }}</template>
						</MkInput>
						<MkButton rounded primary @click="cal">
							<i class="ti ti-calculator"></i>{{ i18n.ts._devTools.calculate }}
						</MkButton>
					</div>
				</MkFolder>
			</div>
		</div>
	</PageWithHeader>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { i18n } from "@/i18n.js";
import MkButton from "@/components/MkButton.vue";
import MkInput from "@/components/MkInput.vue";
import MkSelect from "@/components/MkSelect.vue";
import { transform } from '@/utility/convert-id.js';
import * as os from '@/os.js';
import MkFolder from "@/components/MkFolder.vue";
import { definePage } from "@/page.js";

const allTICOptions = ref([
	{ value: 'aid', text: 'aid' },
	{ value: 'aidx', text: 'aidx' },
	{ value: 'meid', text: 'meid' },
	{ value: 'meidg', text: 'meidg' },
	{ value: 'ulid', text: 'ulid' },
	{ value: 'objectid', text: 'objectid' },
	{ value: 'timestamp', text: i18n.ts._devTools.timestamp },
]);

const value1 = ref('aidx');
const value2 = ref('timestamp');
const inputValue = ref('');
const outputValue = ref('');

const optionsForOneTIC = computed(() => {
	return allTICOptions.value.filter(opt => opt.value !== value2.value);
});

const optionsForTwo = computed(() => {
	return allTICOptions.value.filter(opt => opt.value !== value1.value);
});

watch(value1, (newValue) => {
	if (newValue === value2.value) {
		value2.value = optionsForTwo.value[0]?.value;
	}
});

watch(value2, (newValue) => {
	if (newValue === value1.value) {
		value1.value = optionsForOneTIC.value[0]?.value;
	}
});

function cal() {
	if (!value1.value || !value2.value || !inputValue.value) {
		os.alert({ type: 'error' });
		return;
	}

	const validInput = /^[0-9a-zA-Z]+$/.test(inputValue.value);
	if (!validInput) {
		os.alert({
			type: 'error',
		});
		return;
	}

	outputValue.value = transform(value1.value, value2.value, inputValue.value);
	os.alert({
		type: 'info',
		text: outputValue.value,
	});
}

definePage(() => ({
	title: i18n.ts._devTools.devTools,
	icon: 'ti ti-terminal-2',
}));
</script>
