import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';

export async function injectSeoTags({ filePath, baseUrl, sourceLang, targetLang, relativePath, isOriginal }) {
    const html = await fs.readFile(filePath, 'utf-8');
    const $ = cheerio.load(html);

    // Construct URLs
    // Assuming relativePath is like "contact.html" or "about/index.html"
    // Original URL: https://site.com/contact.html
    // Translated URL: https://site.com/en/contact.html

    const urlPath = relativePath.split(path.sep).join('/');
    const cleanPath = urlPath.replace(/index\.html$/, '').replace(/\/$/, ''); // Remove index.html

    const originalUrl = `${baseUrl}/${cleanPath}`;
    const translatedUrl = `${baseUrl}/${targetLang}/${cleanPath}`;

    // 1. Canonical
    // If isOriginal (FR), canonical is originalUrl.
    // If !isOriginal (EN), canonical is translatedUrl.
    const canonicalUrl = isOriginal ? originalUrl : translatedUrl;

    // Remove existing canonical
    $('link[rel="canonical"]').remove();
    $('head').append(`<link rel="canonical" href="${canonicalUrl}">`);

    // 2. Hreflang
    // We always point to both versions
    $('link[rel="alternate"][hreflang]').remove();
    $('head').append(`<link rel="alternate" hreflang="${sourceLang}" href="${originalUrl}">`);
    $('head').append(`<link rel="alternate" hreflang="${targetLang}" href="${translatedUrl}">`);

    await fs.writeFile(filePath, $.html());
}

export async function generateGlobalSitemap(targetDir, baseUrl) {
    console.log("🗺️  Generating Sitemap...");

    const files = await findAllHtmlFiles(targetDir);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        // Skip noindex pages
        if (content.match(/<meta\s+name=["']robots["']\s+content=["'].*noindex.*["']/i)) continue;

        const relativePath = path.relative(targetDir, file);
        const urlPath = relativePath.split(path.sep).join('/');

        // Clean URL
        let finalUrl = `${baseUrl}/${urlPath}`;
        if (finalUrl.endsWith('index.html')) {
            finalUrl = finalUrl.replace('index.html', '');
        }
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
