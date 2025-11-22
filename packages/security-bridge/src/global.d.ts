declare global {
    interface Window {
        Capacitor?: {
            isNativePlatform?: () => boolean;
            getPlatform?: () => string;
            isPluginAvailable?: (name: string) => boolean;
            Plugins?: Record<string, any>;
            [key: string]: any;
        };
    }
}

export {};
