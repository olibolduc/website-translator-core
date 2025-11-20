# Website Translator Core (v2)

This is the central engine for translating Webflow sites.

## Architecture

*   **Engine**: This repository. Contains the logic.
*   **Sites**: Your other repositories. They contain the HTML/CSS.

## How to use

In your site repository, create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Site

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    uses: olibolduc/website-translator-core/.github/workflows/build-translate-deploy.yml@main
    with:
      source-lang: 'fr'
      target-lang: 'en'
      site-url: 'https://yoursite.com'
    secrets:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
      NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

## Local Development

1.  Clone this repo.
2.  `npm install`
3.  Create `.env` with `GEMINI_API_KEY`.
4.  Run: `node src/index.js translate /path/to/site /path/to/output --lang en --url https://test.com`
