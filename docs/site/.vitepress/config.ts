import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'PDF Studio Docs',
  description:
    'Documentation for PDF Studio — the free, open-source, private-by-design PDF editor that runs entirely in your browser. No uploads, no accounts, no watermarks.',
  base: '/pdf-studio/docs/',
  // cleanUrls intentionally OFF: the unmodified Cloudflare worker maps
  // /pdf-studio/docs/<x>.html -> /docs/<x>.html exactly, so default .html
  // URLs work with no worker change.
  sitemap: { hostname: 'https://navigatorslab.com' },

  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'PDF Studio Docs' }],
    ['meta', { property: 'og:title', content: 'PDF Studio Docs' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Guides, CLI and MCP references, and the security story for PDF Studio — the free, open-source PDF editor that keeps your documents on your device.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://navigatorslab.com/pdf-studio/docs/' }],
    // Absolute URL: scrapers can't resolve relative og:image paths.
    [
      'meta',
      { property: 'og:image', content: 'https://navigatorslab.com/pdf-studio/social-preview.png' },
    ],
    ['meta', { property: 'og:image:alt', content: 'PDF Studio — the private, in-browser PDF editor' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'PDF Studio Docs' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Guides, CLI and MCP references, and the security story for PDF Studio — the free, open-source PDF editor that keeps your documents on your device.',
      },
    ],
    [
      'meta',
      { name: 'twitter:image', content: 'https://navigatorslab.com/pdf-studio/social-preview.png' },
    ],
    ['meta', { name: 'theme-color', content: '#7c5cff' }],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/pdf-studio/favicon.svg',
      },
    ],
  ],

  themeConfig: {
    logo: '/pdf-studio/favicon.svg',
    siteTitle: 'PDF Studio Docs',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Compare', link: '/comparison' },
      { text: 'CLI', link: '/guide/cli' },
      { text: 'MCP', link: '/guide/mcp' },
      { text: 'Security', link: '/guide/security' },
      { text: 'FAQ', link: '/faq' },
    ],

    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/guide/getting-started' },
          { text: 'Installation', link: '/guide/installation' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Editing text', link: '/guide/editing-text' },
          { text: 'Annotations & signing', link: '/guide/annotations' },
          { text: 'Forms', link: '/guide/forms' },
          { text: 'Redaction', link: '/guide/redaction' },
          { text: 'Page management', link: '/guide/pages' },
          { text: 'OCR', link: '/guide/ocr' },
          { text: 'On-device AI', link: '/guide/ai' },
        ],
      },
      {
        text: 'Automation',
        items: [
          { text: 'CLI reference', link: '/guide/cli' },
          { text: 'MCP server', link: '/guide/mcp' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Compare alternatives', link: '/comparison' },
          { text: 'Security & privacy', link: '/guide/security' },
          { text: 'Help translate', link: '/translating' },
          { text: 'FAQ', link: '/faq' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Kayforkind/NavigatorsLab-PDF-Studio' },
    ],

    search: { provider: 'local' },

    footer: {
      message: 'MIT licensed — free for personal, commercial, and everything in between.',
      copyright: '© NavigatorsLab',
    },
  },
})
