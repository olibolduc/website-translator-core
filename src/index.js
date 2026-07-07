#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Builder } from './builder.js';
import { Translator } from './translator.js';
import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';

// Load env vars from .env file if present
dotenv.config();

yargs(hideBin(process.argv))
    .command(
        'translate <source> <target>',
        'Translate a static website',
        (yargs) => {
            return yargs
                .positional('source', {
                    describe: 'Source directory containing the website',
                    type: 'string',
                })
                .positional('target', {
                    describe: 'Target directory for the output',
                    type: 'string',
                })
                .option('lang', {
                    alias: 'l',
                    type: 'string',
                    description: 'Target language code (e.g., en)',
                    demandOption: true,
                })
                .option('source-lang', {
                    alias: 's',
                    type: 'string',
                    description: 'Source language code (e.g., fr)',
                    default: 'fr',
                })
                .option('url', {
                    alias: 'u',
                    type: 'string',
                    description: 'Base URL of the website (e.g., https://example.com)',
                    demandOption: true,
                })
                .option('source-locale', {
                    alias: 'sl',
                    type: 'string',
                    description: 'Source locale for SEO (e.g., fr-CA). Defaults to source-lang.',
                })
                .option('target-locale', {
                    alias: 'tl',
                    type: 'string',
                    description: 'Target locale for SEO (e.g., en-US). Defaults to lang.',
                });
        },
        async (argv) => {
            try {
                console.log('🚀 Starting Website Translator v2');

                const sourceDir = path.resolve(argv.source);
                const targetDir = path.resolve(argv.target);

                if (!fs.existsSync(sourceDir)) {
                    throw new Error(`Source directory not found: ${sourceDir}`);
                }

                // Optional site-specific config (brand names, sizes overrides, ...)
                const configPath = path.join(sourceDir, 'translator.config.json');
                let siteConfig = {};
                if (fs.existsSync(configPath)) {
                    siteConfig = fs.readJsonSync(configPath);
                    console.log(`⚙️  Loaded site config from ${configPath}`);
                }

                // Save translations.json in the source directory so it persists in the site repo
                const cachePath = path.join(sourceDir, 'translations.json');
                const translator = new Translator(cachePath, { brandNames: siteConfig.brandNames });
                const builder = new Builder(translator, siteConfig);

                const targetLangs = argv.lang.split(',').map(s => s.trim());
                const targetLocales = (argv.targetLocale || argv.lang).split(',').map(s => s.trim());

                if (targetLangs.length !== targetLocales.length) {
                    throw new Error(`Mismatch! You provided ${targetLangs.length} languages but ${targetLocales.length} locales. Please provide a locale for EACH language, or omit --target-locale to use defaults.`);
                }

                await builder.build({
                    sourceDir,
                    targetDir,
                    sourceLang: argv.sourceLang,
                    targetLangs, // Pass array
                    sourceLocale: argv.sourceLocale || argv.sourceLang,
                    targetLocales, // Pass array
                    baseUrl: argv.url
                });

                console.log('✅ Build completed successfully!');
            } catch (error) {
                console.error('❌ Error:', error.message);
                process.exit(1);
            }
        }
    )
    .help()
    .parse();
