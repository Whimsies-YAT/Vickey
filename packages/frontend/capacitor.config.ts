import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'org.whimsies.vickey',
	appName: 'Vickey',
	webDir: '../../built/_frontend_vite_',
	bundledWebRuntime: false,
	server: {
		androidScheme: 'https',
	},
	android: {
		path: '../../android',
	},
};

export default config;