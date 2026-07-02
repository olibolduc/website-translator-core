import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';

export async function injectSeoTags({ filePath, baseUrl, currentLang, currentLocale, relativePath, isOriginal, allLanguages }) {
    const html = await fs.readFile(filePath, 'utf-8');
    const $ = cheerio.load(html);

    // Construct URLs
    const urlPath = relativePath.split(path.sep).join('/');
    const cleanPath = urlPath.replace(/index\.html$/, '').replace(/\/$/, ''); // Remove index.html

    // Calculate current canonical URL
    let canonicalUrl;
    if (isOriginal) {
        canonicalUrl = `${baseUrl}/${cleanPath}`;
    } else {
        canonicalUrl = `${baseUrl}/${currentLang}/${cleanPath}`;
    }

    // 1. Canonical
    $('link[rel="canonical"]').remove();
    $('head').append(`<link rel="canonical" href="${canonicalUrl}">`);

    // 2. Hreflang
    // Generate hreflang tags for ALL languages (Source + Targets)
    $('link[rel="alternate"][hreflang]').remove();

    if (allLanguages) {
        allLanguages.forEach(langConfig => {
            let href;
            if (langConfig.isOriginal) {
                href = `${baseUrl}/${cleanPath}`;
            } else {
                href = `${baseUrl}/${langConfig.lang}/${cleanPath}`;
            }
            $('head').append(`<link rel="alternate" hreflang="${langConfig.locale}" href="${href}">`);
        });

        // x-default: recommended by Google, points to the original version
        $('head').append(`<link rel="alternate" hreflang="x-default" href="${baseUrl}/${cleanPath}">`);
    }

    await fs.writeFile(filePath, $.html());
}

export async function generateGlobalSitemap(targetDir, baseUrl) {
    console.log("🗺️  Generating Sitemap...");

    const files = await findAllHtmlFiles(targetDir);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const file of files) {
        // Skip error pages
        if (path.basename(file) === '404.html') continue;

        const content = await fs.readFile(file, 'utf-8');
        // Skip noindex pages
        if (content.match(/<meta\s+name=["']robots["']\s+content=["'].*noindex.*["']/i)) continue;

        const relativePath = path.relative(targetDir, file);
        const urlPath = relativePath.split(path.sep).join('/');

        // Clean URL
        let finalUrl = `${baseUrl}/${urlPath}`;
        finalUrl = finalUrl.replace(/index\.html$/, '');
        if (finalUrl.endsWith('/')) {
            finalUrl = finalUrl.slice(0, -1);
        }

        xml += `  <url>\n    <loc>${finalUrl}</loc>\n  </url>\n`;
    }

    xml += `</urlset>`;
    await fs.writeFile(path.join(targetDir, 'sitemap.xml'), xml);
}

async function findAllHtmlFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await findAllHtmlFiles(filePath));
        } else {
            if (file.endsWith('.html')) {
                results.push(filePath);
            }
        }
    }
    return results;
}
