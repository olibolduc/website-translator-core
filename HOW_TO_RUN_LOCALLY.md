# How to Run Website Translation Locally

## Prerequisites
1. Make sure you have your `.env` file with a valid `GEMINI_API_KEY`
2. Your source website files should be in a directory (e.g., `site-test/`)

## Command to Build Locally

```bash
node website-translator-core/src/index.js translate <source-dir> <output-dir> --source-lang <source-lang> --lang <target-lang> --url <your-url>
```

### Example:
```bash
node website-translator-core/src/index.js translate site-test dist-output --source-lang fr --lang en --url https://espaceurbain.ca
```

### Parameters:
- `<source-dir>`: Directory containing your source HTML files (e.g., `site-test`)
- `<output-dir>`: Where to output the translated site (e.g., `dist-output`)
- `--source-lang <source-lang>`: Source language code (e.g., `fr`, `en`, `es`) - **defaults to `fr` if omitted**
- `--lang <target-lang>`: Target language code (e.g., `en`, `es`, `de`)
- `--url <your-url>`: Your website's base URL (used for sitemap and SEO)

## What Happens:
1. **Copies source files** to the output directory
2. **Translates** HTML files to the target language
3. **Creates** a `/[lang]/` subdirectory with translated files
4. **Copies all assets** (images, CSS, JS) to both locations
5. **Generates** sitemap and injects SEO tags
6. **Saves** translation cache to `<source-dir>/translations.json`

## Viewing Results:
After the build completes, you can:
1. Open `<output-dir>/en/index.html` in your browser
2. Check images are loading correctly
3. Verify translations

## Cache Benefits:
- First run: Translates everything via Gemini API
- Subsequent runs: Uses cache for already-translated text (much faster!)
- Cache file: `<source-dir>/translations.json`

## Clean Build (No Cache):
```bash
rm -f site-test/translations.json && node website-translator-core/src/index.js translate site-test dist-output --source-lang fr --lang en --url https://espaceurbain.ca
```

## Site Config (optional):
Add a `translator.config.json` in the source directory to customize the build:
```json
{
  "brandNames": ["My Studio Name"],
  "sizes": {
    "default": "(max-width: 767px) 90vw, (max-width: 991px) 45vw, 40vw",
    "overrides": [
      { "classContains": "header30_background-image-wrapper", "sizes": "100vw" }
    ]
  }
}
```
- `brandNames`: kept in the original language during translation
- `sizes`: rules used to normalize fixed-pixel `sizes` attributes on images

## Failure Behavior:
If some segments cannot be translated after retries, the build **fails** instead
of deploying pages with mixed languages. Successful segments are already cached,
so simply re-run the build to retry only the failed ones.

## Tips:
- Use the **same source directory** for repeated builds to benefit from caching
- The cache is stored IN the source directory, so it persists across builds
- Delete `translations.json` if you want to re-translate everything
