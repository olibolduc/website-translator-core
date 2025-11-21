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
To ensure your language switcher stays on the same page (e.g., switching from `/about` to `/fr/about`), use this JavaScript snippet.

**1. Add links with `data-lang` attributes:**
In your Webflow/HTML, add your language links and give them a `data-lang` attribute matching the **locale** you defined (or the language code if you didn't specify a locale).

```html
<a href="#" class="lang-switch" data-lang="fr-CA">Français</a>
<a href="#" class="lang-switch" data-lang="en-US">English</a>
```

**2. Add this script to your site (Before `</body>`):**
This script automatically updates the `href` of your buttons to point to the correct translated page.

```javascript
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const switches = document.querySelectorAll('.lang-switch');
    
    switches.forEach(link => {
      const targetLocale = link.getAttribute('data-lang');
      // Find the corresponding SEO tag
      const alternate = document.querySelector(`link[hreflang="${targetLocale}"]`);
      
      if (alternate) {
        link.href = alternate.href;
      } else {
        console.warn(`No translation found for ${targetLocale}`);
        link.style.display = 'none'; // Optional: Hide if no translation
      }
    });
  });
</script>
```

## Local Development

1.  Clone this repo.
2.  `npm install`
3.  Create `.env` with `GEMINI_API_KEY`.
4.  Run: `node src/index.js translate /path/to/site /path/to/output --source-lang fr --lang en --url https://test.com`

For detailed instructions, see [HOW_TO_RUN_LOCALLY.md](./HOW_TO_RUN_LOCALLY.md).
