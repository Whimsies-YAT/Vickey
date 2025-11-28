# Mobile Integration Guide

## Server Configuration for Mobile Apps

Since Vickey is a monolithic app (frontend + backend together), mobile apps need to configure the API server URL at runtime.

**⚠️ IMPORTANT: This feature is ONLY for mobile apps (Capacitor). Web version uses current origin (window.location.origin) and should NOT show server selection UI.**

## Architecture

```
App Launch
  ↓
Check if server configured (SecureStorage)
  ↓
  NO → Show Server Selection Screen
  ↓     User inputs: https://misskey.example.com
  ↓     Verify server (call /api/meta)
  ↓     Save to SecureStorage
  ↓
  YES → Load server URL
  ↓
Initialize APIClient with server URL
  ↓
Check if logged in (has token)
  ↓
  NO → Show Login Screen
  YES → Show Main App
```

## Implementation Example

### Step 1: Check Server Configuration on App Start

```typescript
// packages/frontend/src/boot/mobile-init.ts
import { SecurityAdapter, ServerConfig } from '@vickey/security-bridge';
import { APIClient } from 'misskey-js';

export async function initMobileApp() {
  // Create security adapter
  const security = await SecurityAdapter.create();
  const serverConfig = new ServerConfig(security.storage);

  // Check if server is configured
  const hasServer = await serverConfig.hasServer();

  if (!hasServer) {
    // Show server selection screen
    // This should be a Vue component that prompts user for server URL
    await showServerSelectionScreen(serverConfig);
  }

  // Load server URL
  const serverUrl = await serverConfig.getServerUrl();
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }

  // Initialize API client with configured server
  const apiClient = new APIClient({
    origin: serverUrl,
    fetch: security.fetch, // Use secure fetch with SSL Pinning
  });

  // Check if user is logged in
  const token = await security.storage.get('access_token');
  if (token) {
    apiClient.credential = token;
  }

  return { apiClient, security, serverConfig };
}
```

### Step 2: Server Selection UI Component

```vue
<!-- packages/frontend/src/components/mobile/ServerSelection.vue -->
<template>
  <div class="server-selection">
    <h1>Welcome to Vickey</h1>
    <p>Enter your Misskey server URL</p>

    <input
      v-model="serverUrl"
      type="url"
      placeholder="https://misskey.example.com"
      @input="clearError"
    />

    <button @click="connectServer" :disabled="loading">
      {{ loading ? 'Connecting...' : 'Connect' }}
    </button>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="serverMeta" class="server-info">
      <p>Server: {{ serverMeta.name || serverMeta.uri }}</p>
      <p>Version: {{ serverMeta.version }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ServerConfig } from '@vickey/security-bridge';

const props = defineProps<{
  serverConfig: ServerConfig;
}>();

const emit = defineEmits<{
  connected: [];
}>();

const serverUrl = ref('');
const loading = ref(false);
const error = ref('');
const serverMeta = ref<any>(null);

function clearError() {
  error.value = '';
}

async function connectServer() {
  if (!serverUrl.value) {
    error.value = 'Please enter a server URL';
    return;
  }

  loading.value = true;
  error.value = '';
  serverMeta.value = null;

  try {
    // Verify server
    const result = await props.serverConfig.verifyServer(serverUrl.value);

    if (!result.valid) {
      error.value = result.error || 'Invalid server';
      return;
    }

    // Save server URL
    await props.serverConfig.setServerUrl(serverUrl.value);
    serverMeta.value = result.meta;

    // Emit success
    emit('connected');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Connection failed';
  } finally {
    loading.value = false;
  }
}
</script>
```

### Step 3: Settings - Switch Server

```vue
<!-- packages/frontend/src/pages/settings/server.vue -->
<template>
  <div class="settings-server">
    <h2>Server Settings</h2>

    <div class="current-server">
      <label>Current Server:</label>
      <p>{{ currentServer || 'Not configured' }}</p>
    </div>

    <button @click="changeServer" class="danger">
      Change Server (Logout)
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { serverConfig } from '@/boot/mobile-init';

const currentServer = ref('');

onMounted(async () => {
  currentServer.value = await serverConfig.getServerUrl() || '';
});

async function changeServer() {
  const confirm = window.confirm(
    'Changing server will log you out. Continue?'
  );

  if (confirm) {
    await serverConfig.clearServer();
    // Reload app to show server selection screen
    window.location.reload();
  }
}
</script>
```

## API Reference

### ServerConfig

```typescript
class ServerConfig {
  constructor(storage: SecureStorage);

  // Check if server URL is configured
  hasServer(): Promise<boolean>;

  // Get configured server URL
  getServerUrl(): Promise<string | null>;

  // Set server URL (with validation)
  setServerUrl(url: string): Promise<void>;

  // Clear server and logout
  clearServer(): Promise<void>;

  // Verify server is a valid Misskey instance
  verifyServer(url: string): Promise<{
    valid: boolean;
    error?: string;
    meta?: any;
  }>;
}
```

### CONFIG_KEYS

```typescript
const CONFIG_KEYS = {
  SERVER_URL: 'server_url',
  ACCESS_TOKEN: 'access_token',
  LAST_LOGIN_USER: 'last_login_user',
} as const;
```

## Security Considerations

1. **Server URL Validation**: Always validate URL format before saving
2. **Server Verification**: Call `/api/meta` to ensure it's a Misskey instance
3. **Secure Storage**: Server URL is stored in Keychain/Keystore (not localStorage)
4. **SSL Pinning**: If configured, only trusted certificates are accepted
5. **Clear on Logout**: Server URL persists across logouts (optional: clear it too)

## Common Patterns

### Pattern 1: Remember Last Server
```typescript
// Save server URL but clear token on logout
async function logout() {
  await security.storage.remove(CONFIG_KEYS.ACCESS_TOKEN);
  // Server URL remains for next login
}
```

### Pattern 2: Full Reset
```typescript
// Clear everything including server
async function fullLogout() {
  await serverConfig.clearServer();
  // Forces server selection on next launch
}
```

### Pattern 3: Multiple Accounts
```typescript
// Save multiple server+account pairs
await security.storage.set('accounts', JSON.stringify([
  { server: 'https://misskey.io', username: 'alice' },
  { server: 'https://misskey.example.com', username: 'bob' },
]));
```

## Testing

```typescript
// Test server connectivity
const result = await serverConfig.verifyServer('https://misskey.io');
console.log(result);
// { valid: true, meta: { name: 'Misskey.io', version: '2024.x.x', ... } }

// Test invalid server
const bad = await serverConfig.verifyServer('https://google.com');
console.log(bad);
// { valid: false, error: 'Not a valid Misskey instance' }
```

## Platform Detection

Use `isNativePlatform()` to conditionally show mobile-only features:

```typescript
import { isNativePlatform } from '@vickey/security-bridge';

// In Vue component
const showServerSettings = isNativePlatform(); // true on mobile, false on web
```

```vue
<!-- Only show server settings on mobile -->
<div v-if="isNativePlatform()">
  <button @click="changeServer">Change Server</button>
</div>
```

## Get Server URL (Web vs Mobile)

```typescript
import { isNativePlatform, ServerConfig, SecurityAdapter } from '@vickey/security-bridge';

async function getServerUrl(): Promise<string> {
  if (isNativePlatform()) {
    // Mobile: from SecureStorage
    const security = await SecurityAdapter.create();
    const serverConfig = new ServerConfig(security.storage);
    const url = await serverConfig.getServerUrl();
    if (!url) throw new Error('Server not configured');
    return url;
  } else {
    // Web: same origin
    return window.location.origin;
  }
}

// Initialize API client
const serverUrl = await getServerUrl();
const api = new APIClient({
  origin: serverUrl,
  fetch: security.fetch,
});
```

## Conditional Routing

```typescript
// packages/frontend/src/router/index.ts
import { isNativePlatform } from '@vickey/security-bridge';

const routes = [
  // ... normal routes
];

// Add mobile-only routes
if (isNativePlatform()) {
  routes.push({
    path: '/server-selection',
    component: () => import('@/pages/mobile/ServerSelection.vue'),
  });
  routes.push({
    path: '/settings/server',
    component: () => import('@/pages/mobile/ServerSettings.vue'),
  });
}
```