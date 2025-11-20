import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import { injectSeoTags, generateGlobalSitemap } from './seo.js';

export class Builder {
    constructor(translator) {
        this.translator = translator;
    }

    async build({ sourceDir, targetDir, sourceLang, targetLang, baseUrl }) {
        console.log(`🏗️  Building site: ${sourceLang} -> ${targetLang}`);

        // 1. Clean target directory
        await fs.emptyDir(targetDir);

        // 2. Copy source to target (Base version)
        // We copy everything first, then we'll process the translated version in a subdirectory
        console.log("📂 Copying assets...");
        await fs.copy(sourceDir, targetDir, {
            filter: (src) => {
                const basename = path.basename(src);
                return !['.git', 'node_modules', '.env', 'dist', 'dist-full'].includes(basename);
            }
        });

        // 3. Create language subdirectory (e.g., /en)
        const langDir = path.join(targetDir, targetLang);
        await fs.ensureDir(langDir);

        // 4. Find all HTML files
        const htmlFiles = await this.findHtmlFiles(targetDir); // Search in targetDir (base version)

        // 5. Process each file
        for (const file of htmlFiles) {
            const relativePath = path.relative(targetDir, file);

            // Skip if we are already inside the langDir (shouldn't happen yet but good safety)
            if (relativePath.startsWith(targetLang)) continue;

            console.log(`📄 Processing ${relativePath}...`);

            // A. Prepare Translated Version
            const content = await fs.readFile(file, 'utf-8');
            const translatedContent = await this.translateHtml(content, sourceLang, targetLang);

            // Save translated file to langDir
            // TODO: Implement URL rewriting/slug translation here if needed
            const targetPath = path.join(langDir, relativePath);
            await fs.ensureDir(path.dirname(targetPath));
            await fs.writeFile(targetPath, translatedContent);

            // B. Inject SEO Tags (Hreflang/Canonical) into BOTH versions
            // We need to update the original file in targetDir AND the new file in langDir
            await injectSeoTags({
                filePath: file, // Original (FR)
                baseUrl,
                sourceLang,
                targetLang,
                relativePath,
                isOriginal: true
            });

            await injectSeoTags({
                filePath: targetPath, // Translated (EN)
                baseUrl,
                sourceLang,
                targetLang,
                relativePath,
                isOriginal: false
            });
        }

        // 6. Copy Assets to Lang Dir (Simple approach: Duplicate assets)
        console.log("📦 Duplicating assets for translated version...");

        // We copy from sourceDir again to avoid "copying target into itself" issues
        // if targetDir is inside sourceDir.
        await fs.copy(sourceDir, langDir, {
            filter: (src) => {
                const basename = path.basename(src);

                // Exclude system files
                if (['.git', 'node_modules', '.env'].includes(basename)) return false;

                // Exclude the output directory itself if it's inside source
                // We need to resolve paths to be sure
                const absSrc = path.resolve(src);
                const absTarget = path.resolve(targetDir);
                if (absSrc === absTarget) return false;

                // Don't copy HTML files (we already generated them)
                if (src.endsWith('.html')) return false;

                return true;
            }
        });

        // 7. Generate Sitemap
        await generateGlobalSitemap(targetDir, baseUrl);

        console.log(`✨ Build complete! Output: ${targetDir}`);
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

    async translateHtml(html, sourceLang, targetLang) {
        const $ = cheerio.load(html);
        const nodesToTranslate = [];

        // Extract text nodes
        $('body').find('*').contents().each((i, el) => {
            if (el.type === 'text') {
                const text = $(el).text().trim();
                if (text.length > 1) { // Ignore single chars/empty
                    nodesToTranslate.push({ node: el, text, type: 'text' });
                }
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
                if (item.type === 'text') {
                    $(item.node).replaceWith(translation);
                } else if (item.type === 'attr') {
                    $(item.node).attr(item.attrName, translation);
                } else if (item.type === 'meta') {
                    item.node.attr('content', translation);
                }
            }
        });

        // Update Lang Attribute
        $('html').attr('lang', targetLang);

        return $.html();
    }
}
