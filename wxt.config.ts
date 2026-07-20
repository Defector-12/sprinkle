import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Context Reader',
    description: '在当前技术文章的上下文中提问。',
    version: '0.1.0',
    permissions: ['activeTab', 'storage', 'tabs', 'sidePanel'],
    host_permissions: [
      'http://*/*',
      'https://*/*',
      'https://api.deepseek.com/*',
    ],
    action: {
      default_title: '打开 Context Reader',
    },
  },
});
