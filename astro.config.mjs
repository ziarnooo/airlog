// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ziarnooo.github.io',
  base: '/airlog',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: false,
  // Kompresja HTML usuwała spacje między tekstem a inline-elementami ("data.<strong>").
  compressHTML: false,
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })],
});
