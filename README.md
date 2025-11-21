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

### Advanced Locale Configuration
You can decouple the URL structure from the SEO language tag.

**Flags:**
- `--source-locale`: Sets the `<html lang>` and `hreflang` for the source site. Defaults to `--source-lang`.
- `--target-locale`: Sets the `<html lang>` and `hreflang` for the translated site. Defaults to `--lang`.

**Common Scenarios:**

**1. French Canadian Source (Root) -> English Target (`/en`)**
Use `fr-CA` for SEO but keep the root clean.
```bash
node src/index.js translate ... --source-lang fr --source-locale fr-CA --lang en
```
*Result:* Root is `fr-CA` (SEO), `/en` is `en` (SEO).

**2. English Source (Root) -> French Canadian Target (`/fr`)**
Use `fr-CA` for SEO but keep the URL as `/fr`.
```bash
node src/index.js translate ... --source-lang en --lang fr --target-locale fr-CA
```
*Result:* Root is `en` (SEO), `/fr` is `fr-CA` (SEO).

## Local Development

1.  Clone this repo.
2.  `npm install`
3.  Create `.env` with `GEMINI_API_KEY`.
4.  Run: `node src/index.js translate /path/to/site /path/to/output --source-lang fr --lang en --url https://test.com`

For detailed instructions, see [HOW_TO_RUN_LOCALLY.md](./HOW_TO_RUN_LOCALLY.md).
