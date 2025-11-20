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

                const translator = new Translator();
                const builder = new Builder(translator);

                await builder.build({
                    sourceDir,
                    targetDir,
                    sourceLang: argv.sourceLang,
                    targetLang: argv.lang,
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
