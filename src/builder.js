import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import { injectSeoTags, generateGlobalSitemap } from './seo.js';

// Items that must never be copied into the published output
// (repo/tooling files that would otherwise become publicly accessible)
const EXCLUDED_ITEMS = [
    '.git', '.github', 'node_modules', 'dist', 'dist-full', 'engine',
    'translations.json', 'translator.config.json',
    'README.md', '.gitignore', 'package.json', 'package-lock.json'
];

function isExcludedItem(item) {
    return EXCLUDED_ITEMS.includes(item) || item.startsWith('.env');
}

export class Builder {
    constructor(translator, config = {}) {
        this.translator = translator;
        this.config = config;
    }

    async build({ sourceDir, targetDir, sourceLang, targetLangs, sourceLocale, targetLocales, baseUrl }) {
        console.log(`🏗️  Building site: ${sourceLang} -> ${targetLangs.join(', ')}`);
        console.log(`🌍 Locales: Source=${sourceLocale}, Targets=${targetLocales.join(', ')}`);

        // 1. Clean target directory
        await fs.emptyDir(targetDir);

        // 2. Copy source to target (Base version)
        console.log("📂 Copying assets...");
        const items = await fs.readdir(sourceDir);

        for (const item of items) {
            // Skip system/output folders
            if (isExcludedItem(item)) continue;

            const srcPath = path.join(sourceDir, item);
            const destPath = path.join(targetDir, item);

            // Safety check: don't copy if srcPath is the targetDir
            if (path.resolve(srcPath) === path.resolve(targetDir)) continue;

            await fs.copy(srcPath, destPath);
        }
        console.log(`📂 Copied source files to ${targetDir}`);

        // Prepare language definitions for SEO
        // [{ lang: 'fr', locale: 'fr-CA', isOriginal: true }, { lang: 'en', locale: 'en-US', isOriginal: false }, ...]
        const allLanguages = [
            { lang: sourceLang, locale: sourceLocale, isOriginal: true }
        ];
        targetLangs.forEach((lang, index) => {
            // Avoid adding source lang again if it's in the target list (Monolingual case handled differently below)
            if (lang !== sourceLang) {
                allLanguages.push({ lang: lang, locale: targetLocales[index], isOriginal: false });
            }
        });

        // Monolingual Mode Check
        // If we only have one target and it equals source
        const isMonolingual = targetLangs.length === 1 && targetLangs[0] === sourceLang;

        if (isMonolingual) {
            console.log('ℹ️  Monolingual mode detected. Skipping translation but ensuring SEO compliance.');
        } else {
            // Create directories for all targets
            for (const lang of targetLangs) {
                if (lang === sourceLang) continue; // Don't create subdir for source lang
                const langDir = path.join(targetDir, lang);
                await fs.ensureDir(langDir);
            }
        }

        // 3. Fix broken image references
        console.log('🔧 Scanning for image files...');
        const imageMap = await this.findAllImages(targetDir);
        console.log(`   Found ${imageMap.size} unique image basenames`);

        // Note: We'll fix HTML files as we process them below

        // 4. Find all HTML files
        const htmlFiles = await this.findHtmlFiles(targetDir); // Search in targetDir (base version)

        // 5. Process each file
        for (const file of htmlFiles) {
            const relativePath = path.relative(targetDir, file);

            // Skip if we are already inside a langDir (shouldn't happen yet but good safety)
            // We only want to process the "Root" files and generate translations from them
            const isInLangDir = targetLangs.some(lang => relativePath.startsWith(lang + path.sep));
            if (isInLangDir) continue;

            console.log(`📄 Processing ${relativePath}...`);

            // Fix Image References First
            const fixResult = await this.fixImageReferences(file, imageMap, targetDir);
            if (fixResult.fixed) {
                console.log(`   🔧 Fixed ${fixResult.count} image reference(s)`);
                fixResult.fixes.forEach(fix => console.log(`      ${fix}`));
            }

            // Normalize image sizes attributes
            const sizesResult = await this.normalizeSizesAttributes(file, targetDir);
            if (sizesResult.fixed) {
                console.log(`   📐 Normalized ${sizesResult.count} image sizes attribute(s)`);
                sizesResult.fixes.forEach(fix => console.log(`      ${fix}`));
            }

            // Process Root File (Source Language)
            // Always update its SEO tags
            await injectSeoTags({
                filePath: file,
                baseUrl,
                currentLang: sourceLang,
                currentLocale: sourceLocale,
                relativePath,
                isOriginal: true,
                allLanguages // Pass all languages for hreflang generation
            });

            // Update Lang Attribute for Root File
            const rootContent = await fs.readFile(file, 'utf-8');
            let $root = cheerio.load(rootContent);
            $root('html').attr('lang', sourceLocale);

            // Update Language Switcher State (Static)
            this.updateLanguageSwitcher($root, sourceLocale);

            // Inject Smart Switcher Script (Root)
            let rootHtml = $root.html();
            rootHtml = await this.injectSmartSwitcherScript(rootHtml);

            await fs.writeFile(file, rootHtml);


            if (isMonolingual) {
                // If monolingual, we are done (SEO tags updated above)
                continue;
            }

            // Generate Translations for each Target Language
            for (let i = 0; i < targetLangs.length; i++) {
                const targetLang = targetLangs[i];
                const targetLocale = targetLocales[i];

                if (targetLang === sourceLang) continue; // Skip source lang

                console.log(`   - Translating to ${targetLang} (${targetLocale})...`);

                // A. Prepare Translated Version
                const content = await fs.readFile(file, 'utf-8');
                let translatedContent = await this.translateHtml(content, sourceLang, targetLang, targetLocale);

                // Prefix internal links with the language so navigation stays in-language
                translatedContent = this.localizeInternalLinks(translatedContent, targetLang);

                // Inject Smart Switcher Script (Translated)
                translatedContent = await this.injectSmartSwitcherScript(translatedContent);

                // Save translated file to langDir
                const langDir = path.join(targetDir, targetLang);
                const targetPath = path.join(langDir, relativePath);
                await fs.ensureDir(path.dirname(targetPath));
                await fs.writeFile(targetPath, translatedContent);

                // B. Inject SEO Tags into Translated Version
                await injectSeoTags({
                    filePath: targetPath,
                    baseUrl,
                    currentLang: targetLang,
                    currentLocale: targetLocale,
                    relativePath,
                    isOriginal: false,
                    allLanguages
                });
            }
        }

        // 6. Copy Assets to Lang Dirs
        if (!isMonolingual) {
            console.log("📦 Duplicating assets for translated versions...");

            for (const targetLang of targetLangs) {
                if (targetLang === sourceLang) continue;

                const langDir = path.join(targetDir, targetLang);
                const assetItems = await fs.readdir(sourceDir);

                for (const item of assetItems) {
                    // Skip system/output folders
                    if (isExcludedItem(item)) continue;

                    const srcPath = path.join(sourceDir, item);
                    const destPath = path.join(langDir, item);

                    // Safety check
                    if (path.resolve(srcPath) === path.resolve(targetDir)) continue;

                    // Don't copy HTML files
                    if (item.endsWith('.html')) continue;

                    // Copy assets
                    await fs.copy(srcPath, destPath, {
                        filter: (src) => {
                            if (src.endsWith('.html')) return false;
                            return true;
                        }
                    });
                }
            }
        }

        // 7. Generate Sitemap
        await generateGlobalSitemap(targetDir, baseUrl);

        // 8. Handle Redirects (404s)
        await this.handleRedirects(sourceDir, targetDir, targetLangs);

        // 9. Fail if translations are missing, instead of silently deploying
        // pages with source-language text. Successful chunks are already cached,
        // so a re-run only retries the failed segments.
        if (this.translator.missingCount > 0) {
            throw new Error(`${this.translator.missingCount} segment(s) could not be translated. Aborting to avoid deploying mixed-language pages. Re-run the build to retry only the failed segments (successful ones are cached).`);
        }

        console.log(`✨ Build complete! Output: ${targetDir}`);
    }

    async handleRedirects(sourceDir, targetDir, targetLangs) {
        console.log('🔀 Generating _redirects file...');
        const redirectsPath = path.join(sourceDir, '_redirects');
        let content = '';

        // 1. Read existing _redirects if it exists
        if (await fs.pathExists(redirectsPath)) {
            content = await fs.readFile(redirectsPath, 'utf-8');
            content += '\n\n# --- Generated 404 Rules ---\n';
        } else {
            content = '# Redirects generated by Website Translator\n\n';
        }

        // 2. Add 404 rules for each target language
        // Rule: /lang/*  /lang/404.html  404
        for (const lang of targetLangs) {
            content += `/${lang}/*  /${lang}/404.html  404\n`;
        }

        // 3. Add default fallback (catch-all)
        // Only add if not already present (simple check)
        if (!content.includes('/*  /404.html  404')) {
            content += '/*  /404.html  404\n';
        }

        // 4. Write to output
        await fs.writeFile(path.join(targetDir, '_redirects'), content);
        console.log('   ✅ _redirects file created/updated');
    }

    localizeInternalLinks(html, targetLang) {
        const $ = cheerio.load(html);
        // Extensions that point to shared assets rather than pages; those must
        // keep their root path so all languages reference a single copy
        const assetExtensions = [
            '.css', '.js', '.json', '.xml', '.txt', '.pdf',
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico',
            '.mp4', '.webm', '.mp3', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip'
        ];

        $('a[href]').each((i, el) => {
            const $el = $(el);

            // Language switcher links are handled by the smart switcher script
            if ($el.attr('data-lang')) return;

            const href = $el.attr('href');

            // Only rewrite root-relative internal links (skip external, protocol-relative,
            // anchors, mailto:, tel:, and relative paths which already resolve inside /lang/)
            if (!href || !href.startsWith('/') || href.startsWith('//')) return;

            // Already language-prefixed
            if (href === `/${targetLang}` || href.startsWith(`/${targetLang}/`) || href.startsWith(`/${targetLang}#`)) return;

            const pathPart = href.split(/[?#]/)[0];
            const ext = path.extname(pathPart).toLowerCase();
            if (assetExtensions.includes(ext)) return;

            $el.attr('href', `/${targetLang}${href}`);
        });

        return $.html();
    }

    async injectSmartSwitcherScript(html) {
        const $ = cheerio.load(html);

        // Idempotent: translated pages are generated from the root file which
        // already contains the script, so don't inject it twice
        if ($('script[data-smart-switcher]').length > 0) {
            return $.html();
        }

        const script = `
    <script data-smart-switcher>
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('a[data-lang]').forEach(link => {
          const locale = link.getAttribute('data-lang');
          // Handle link implementation
          const alternate = document.querySelector('link[hreflang="' + locale + '"]');
          if (alternate && link.tagName === 'A') {
            link.href = alternate.href;
          }
        });

        // Update all language elements (links and text)
        document.querySelectorAll('[data-lang]').forEach(el => {
          const locale = el.getAttribute('data-lang');
          const currentLang = document.documentElement.lang;
          
          if (locale === currentLang || (currentLang.startsWith(locale + '-'))) {
            el.classList.add('current-lang');
          } else {
            el.classList.remove('current-lang');
          }
        });
      });
    </script>
        `;
        $('body').append(script);
        return $.html();
    }

    async findHtmlFiles(dir) {
        let results = [];
        const list = await fs.readdir(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = await fs.stat(filePath);
            if (stat && stat.isDirectory()) {
                if (file === 'node_modules' || file === '.git' || file.startsWith('.')) continue;
                results = results.concat(await this.findHtmlFiles(filePath));
            } else {
                if (file.endsWith('.html')) {
                    results.push(filePath);
                }
            }
        }
        return results;
    }

    async findAllImages(dir) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif', '.ico'];
        let imageMap = new Map(); // basename -> full path

        const scan = async (directory) => {
            const list = await fs.readdir(directory);
            for (const file of list) {
                const filePath = path.join(directory, file);
                const stat = await fs.stat(filePath);

                if (stat && stat.isDirectory()) {
                    if (file === 'node_modules' || file === '.git' || file.startsWith('.')) continue;
                    await scan(filePath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (imageExtensions.includes(ext)) {
                        // Store relative path from dir
                        const relativePath = path.relative(dir, filePath);
                        const basename = path.basename(file);

                        // Store with basename as key for quick lookup
                        if (!imageMap.has(basename)) {
                            imageMap.set(basename, []);
                        }
                        imageMap.get(basename).push(relativePath);
                    }
                }
            }
        };

        await scan(dir);
        return imageMap;
    }

    async translateHtml(html, sourceLang, targetLang, targetLocale) {
        const $ = cheerio.load(html);
        const nodesToTranslate = [];

        // Extract nodes to translate
        $('body').find('*').each((i, el) => {
            const $el = $(el);

            // Skip script and style tags (e.g. JSON-LD, custom CSS)
            if ($el.is('script') || $el.is('style') || $el.is('noscript')) return;

            // Skip language switcher links (they have data-lang attribute)
            if ($el.attr('data-lang')) return;

            const hasElementChildren = $el.children().length > 0;

            if (!hasElementChildren) {
                // Leaf element (e.g., h3, button, p without links)
                // Safe to replace entire text content
                const text = $el.text().trim();
                if (text.length > 1) {
                    nodesToTranslate.push({ node: el, text: text, type: 'element' });
                }
            } else {
                // Mixed content (e.g., p with a link inside)
                // Must translate individual text nodes to preserve structure
                $el.contents().each((j, child) => {
                    if (child.type === 'text') {
                        const text = child.data;
                        // Only translate if it has meaningful content
                        if (text.trim().length > 1) {
                            nodesToTranslate.push({ node: child, text: text, type: 'text-node' });
                        }
                    }
                });
            }
        });

        // Extract attributes (alt, title, placeholder, meta description)
        $('*').each((i, el) => {
            ['alt', 'title', 'placeholder', 'aria-label'].forEach(attr => {
                const val = $(el).attr(attr);
                if (val && val.trim().length > 1) {
                    nodesToTranslate.push({ node: el, text: val, type: 'attr', attrName: attr });
                }
            });
        });

        // Extract input/button values (e.g., <input type="submit" value="Send">)
        $('input[value], button[value]').each((i, el) => {
            const val = $(el).attr('value');
            if (val && val.trim().length > 1) {
                nodesToTranslate.push({ node: el, text: val, type: 'attr', attrName: 'value' });
            }
        });

        // Meta description
        const metaDesc = $('meta[name="description"]').attr('content');
        if (metaDesc) {
            nodesToTranslate.push({ node: $('meta[name="description"]'), text: metaDesc, type: 'meta' });
        }

        // Translate Batch
        const texts = nodesToTranslate.map(n => n.text);
        const translations = await this.translator.translateBatch(texts, sourceLang, targetLang);

        // Apply Translations
        nodesToTranslate.forEach((item, index) => {
            const translation = translations[index];
            if (translation) {
                if (item.type === 'element') {
                    // Safe to use .text() for leaf elements
                    $(item.node).text(translation);
                } else if (item.type === 'text-node') {
                    // For text nodes in mixed content, update data directly
                    // This preserves siblings (like <a> tags)
                    item.node.data = translation;
                } else if (item.type === 'attr') {
                    $(item.node).attr(item.attrName, translation);
                } else if (item.type === 'meta') {
                    item.node.attr('content', translation);
                }
            }
        });

        // Update Lang Attribute
        $('html').attr('lang', targetLocale);

        // Fix form action URLs to maintain language context
        // If a form posts to /thank-you, it should post to /en/thank-you on English pages
        $('form[action]').each((i, el) => {
            const action = $(el).attr('action');
            // Only fix relative URLs (not external or anchor-only)
            if (action && action.startsWith('/') && !action.startsWith('//')) {
                // Don't modify if already has language prefix
                if (!action.startsWith(`/${targetLang}/`)) {
                    const newAction = `/${targetLang}${action}`;
                    $(el).attr('action', newAction);
                }
            }
        });

        // Update Language Switcher State (Static)
        this.updateLanguageSwitcher($, targetLocale);

        return $.html();
    }

    async fixImageReferences(htmlPath, imageMap, targetDir) {
        const html = await fs.readFile(htmlPath, 'utf-8');
        const $ = cheerio.load(html);
        let fixCount = 0;
        const fixes = [];

        // Helper: Try to find actual file for a broken reference
        const findActualFile = (brokenPath) => {
            // Never touch external URLs, protocol-relative URLs or data URIs:
            // basename-matching them against local files would corrupt valid references
            if (!brokenPath || /^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/)/i.test(brokenPath)) {
                return null;
            }

            const basename = path.basename(brokenPath);
            const dirname = path.dirname(brokenPath);

            // 1. Check if file exists as-is
            const fullPath = path.join(targetDir, brokenPath);
            if (fs.existsSync(fullPath)) {
                return null; // Not broken, skip
            }

            // 2. Look for exact basename match
            if (imageMap.has(basename)) {
                const candidates = imageMap.get(basename);
                if (candidates.length === 1) {
                    return candidates[0];
                }
                // Multiple matches, prefer same directory
                const sameDirMatch = candidates.find(c => path.dirname(c) === dirname);
                if (sameDirMatch) return sameDirMatch;
                return candidates[0]; // Fallback to first match
            }

            // 3. Fuzzy match: Remove version suffixes (_1, _2, etc.)
            const baseWithoutVersion = basename.replace(/(_\d+)/, ''); // logo_1.avif -> logo.avif
            if (baseWithoutVersion !== basename && imageMap.has(baseWithoutVersion)) {
                return imageMap.get(baseWithoutVersion)[0];
            }

            // 4. Try matching without extension
            const nameWithoutExt = path.basename(basename, path.extname(basename));
            for (const [key, paths] of imageMap.entries()) {
                const keyWithoutExt = path.basename(key, path.extname(key));
                if (keyWithoutExt === nameWithoutExt) {
                    return paths[0];
                }
            }

            return null; // Could not find
        };

        // Fix <img src="...">
        $('img[src]').each((i, elem) => {
            const src = $(elem).attr('src');
            const actualFile = findActualFile(src);
            if (actualFile) {
                $(elem).attr('src', actualFile);
                fixes.push(`${src} → ${actualFile}`);
                fixCount++;
            }
        });

        // Fix <img srcset="...">
        $('img[srcset]').each((i, elem) => {
            const srcset = $(elem).attr('srcset');
            const parts = srcset.split(',').map(s => s.trim());
            let updated = false;

            const newParts = parts.map(part => {
                const [url, descriptor] = part.split(/\s+/);
                const actualFile = findActualFile(url);
                if (actualFile) {
                    updated = true;
                    return descriptor ? `${actualFile} ${descriptor}` : actualFile;
                }
                return part;
            });

            if (updated) {
                $(elem).attr('srcset', newParts.join(', '));
                fixCount++;
            }
        });

        // Fix CSS background-image in <style> and inline styles
        $('style').each((i, elem) => {
            let css = $(elem).html();
            const urlRegex = /url\(['"]?([^'"()]+)['"]?\)/g;
            css = css.replace(urlRegex, (match, url) => {
                const actualFile = findActualFile(url);
                if (actualFile) {
                    fixes.push(`${url} → ${actualFile} (CSS)`);
                    fixCount++;
                    return `url('${actualFile}')`;
                }
                return match;
            });
            $(elem).html(css);
        });

        // Fix inline styles
        $('[style*="url("]').each((i, elem) => {
            let style = $(elem).attr('style');
            const urlRegex = /url\(['"]?([^'"()]+)['"]?\)/g;
            style = style.replace(urlRegex, (match, url) => {
                const actualFile = findActualFile(url);
                if (actualFile) {
                    fixCount++;
                    return `url('${actualFile}')`;
                }
                return match;
            });
            $(elem).attr('style', style);
        });

        // Save if changes were made
        if (fixCount > 0) {
            await fs.writeFile(htmlPath, $.html());
            return { fixed: true, count: fixCount, fixes };
        }

        return { fixed: false, count: 0, fixes: [] };
    }

    async normalizeSizesAttributes(htmlPath, targetDir) {
        const html = await fs.readFile(htmlPath, 'utf-8');
        const $ = cheerio.load(html);
        let fixCount = 0;
        const fixes = [];

        // Pattern to detect sizes attributes that END with fixed pixel values
        // This pattern matches: "...240px" or "...239.9921875px" but NOT "(max-width: 479px) 90vw"
        // The key is to match pixel values that are NOT inside parentheses (media queries)
        const fixedPixelPattern = /,\s*\d+(\.\d+)?px\s*$/;

        $('img[sizes]').each((i, elem) => {
            const currentSizes = $(elem).attr('sizes');

            // Check if sizes ends with a fixed pixel value (after a comma)
            // OR if it's ONLY a pixel value with no media queries
            const endsWithPixels = fixedPixelPattern.test(currentSizes);
            const onlyPixels = /^\s*\d+(\.\d+)?px\s*$/.test(currentSizes);

            if (endsWithPixels || onlyPixels) {
                const $wrapper = $(elem).closest('[class*="wrapper"]');
                const wrapperClass = $wrapper.attr('class') || '';

                // Site-specific rules come from translator.config.json:
                // { "sizes": { "default": "...", "overrides": [{ "classContains": "...", "sizes": "..." }] } }
                const sizesConfig = this.config.sizes || {};
                const overrides = sizesConfig.overrides || [];

                const override = overrides.find(o =>
                    o.classContains && wrapperClass.includes(o.classContains)
                );

                const newSizes = override
                    ? override.sizes
                    : (sizesConfig.default || '(max-width: 767px) 90vw, (max-width: 991px) 45vw, 40vw');

                $(elem).attr('sizes', newSizes);
                fixes.push(`${currentSizes} → ${newSizes}`);
                fixCount++;
            }
        });

        if (fixCount > 0) {
            await fs.writeFile(htmlPath, $.html());
            return { fixed: true, count: fixCount, fixes };
        }

        return { fixed: false, count: 0, fixes: [] };
    }

    updateLanguageSwitcher($, currentLocale) {
        $('[data-lang]').each((i, el) => {
            const $el = $(el);
            const locale = $el.attr('data-lang');

            // Check for match (exact or prefix for sub-locales)
            if (locale === currentLocale || currentLocale.startsWith(locale + '-')) {
                $el.addClass('current-lang');
            } else {
                $el.removeClass('current-lang');
            }
        });
    }
}
