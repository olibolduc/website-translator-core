import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import { injectSeoTags, generateGlobalSitemap } from './seo.js';

export class Builder {
    constructor(translator) {
        this.translator = translator;
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
            if (['.git', 'node_modules', '.env', 'dist', 'dist-full', 'engine'].includes(item)) continue;

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
                    if (['.git', 'node_modules', '.env', 'dist', 'dist-full', 'engine'].includes(item)) continue;

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

        console.log(`✨ Build complete! Output: ${targetDir}`);
    }

    async injectSmartSwitcherScript(html) {
        const $ = cheerio.load(html);
        const script = `
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('a[data-lang]').forEach(link => {
          const locale = link.getAttribute('data-lang');
          const alternate = document.querySelector('link[hreflang="' + locale + '"]');
          if (alternate) {
            link.href = alternate.href;
          }
          
          // Mark active language
          const currentLang = document.documentElement.lang;
          if (locale === currentLang || (currentLang.startsWith(locale + '-'))) {
            link.classList.add('current-lang');
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

    async translateHtml(html, sourceLang, targetLang, targetLocale) {
        const $ = cheerio.load(html);
        const nodesToTranslate = [];

        // Extract nodes to translate
        $('body').find('*').each((i, el) => {
            const $el = $(el);

            // Skip script and style tags (e.g. JSON-LD, custom CSS)
            if ($el.is('script') || $el.is('style') || $el.is('noscript')) return;

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

        return $.html();
    }
}
