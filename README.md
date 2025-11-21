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

### Monolingual Mode
If you want to deploy a site without translation (e.g., a French-only site), simply set `source-lang` and `target-lang` to the same value (e.g., both 'fr'). The system will skip translation and deploy the original site.

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

### Multi-Language Support (New!)
You can translate to multiple languages at once by using comma-separated lists.

**Example: English -> Spanish & Italian**
```bash
node src/index.js translate ... --source-lang en --lang es,it --target-locale es-ES,it-IT
```
*Result:*
- Root (`/`): English
- `/es`: Spanish (es-ES)
- `/it`: Italian (it-IT)
- All pages will have correct `hreflang` tags pointing to all other versions.

### Smart Language Switcher
The system **automatically injects** a script that makes your language switcher work perfectly. It ensures that when a user clicks "English", they go to the *English version of the current page* (e.g., `/about` -> `/en/about`), not just the home page.

**How to set it up in Webflow:**

1.  **Create your links:** Add a Link Block or Text Link for each language (e.g., "FR", "EN").
2.  **Set a dummy URL:** Set the link URL to `#` (or anything). The script will overwrite this.
3.  **Add a Custom Attribute:**
    *   Select the link.
    *   Go to the **Settings** panel (Gear icon).
    *   Scroll to **Custom Attributes**.
    *   Add `data-lang` with the value of your **locale** (e.g., `fr-CA`, `en-US`).

**Example HTML output:**
```html
<a href="#" data-lang="fr-CA">Français</a>
<a href="#" data-lang="en-US">English</a>
```

**That's it!** The injected script will automatically:
1.  **Update the Link:** It finds the correct URL for the *current page* (using the generated SEO tags) and updates the `href`.
2.  **Mark Active Language:** It adds a `current-lang` class to the link matching the current page's language. You can style this class in Webflow (e.g., make it bold or hide it).

## Local Development

1.  Clone this repo.
2.  `npm install`
3.  Create `.env` with `GEMINI_API_KEY`.
4.  Run: `node src/index.js translate /path/to/site /path/to/output --source-lang fr --lang en --url https://test.com`

For detailed instructions, see [HOW_TO_RUN_LOCALLY.md](./HOW_TO_RUN_LOCALLY.md).
