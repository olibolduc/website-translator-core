import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs-extra';
import path from 'path';

export class Translator {
    constructor(cachePath) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not defined in environment variables");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        this.cache = {};
        this.cacheFile = cachePath || 'translations.json';
        this.loadCache();
    }

    loadCache() {
        console.log(`🔍 Looking for cache at: ${this.cacheFile}`);
        if (fs.existsSync(this.cacheFile)) {
            try {
                this.cache = fs.readJsonSync(this.cacheFile);
                const langKeys = Object.keys(this.cache);
                const totalEntries = langKeys.reduce((sum, lang) => sum + Object.keys(this.cache[lang] || {}).length, 0);
                console.log(`📦 Cache loaded: ${totalEntries} entries across ${langKeys.length} language(s)`);
            } catch (e) {
                console.warn("Could not read cache file, starting fresh.");
                this.cache = {};
            }
        } else {
            console.log(`📝 No existing cache found, starting fresh.`);
        }
    }

    saveCache() {
        const langKeys = Object.keys(this.cache);
        const totalEntries = langKeys.reduce((sum, lang) => sum + Object.keys(this.cache[lang] || {}).length, 0);
        console.log(`💾 Saving cache: ${totalEntries} entries to ${this.cacheFile}`);
        fs.writeJsonSync(this.cacheFile, this.cache, { spaces: 2 });
    }

    get(text, lang) {
        if (this.cache[lang] && this.cache[lang][text]) {
            return this.cache[lang][text];
        }
        return null;
    }

    set(text, translation, lang) {
        if (!this.cache[lang]) {
            this.cache[lang] = {};
        }
        this.cache[lang][text] = translation;
    }

    async translateBatch(texts, sourceLang, targetLang) {
        if (texts.length === 0) return [];

        // Filter out texts that are already cached
        const missingTexts = texts.filter(t => !this.get(t, targetLang));
        const cachedCount = texts.length - missingTexts.length;

        if (cachedCount > 0) {
            console.log(`✅ Using ${cachedCount} cached translations`);
        }

        if (missingTexts.length > 0) {
            console.log(`🤖 Translating ${missingTexts.length} new segments with Gemini...`);

            // Split into chunks to avoid hitting token limits
            const chunkSize = 50;
            for (let i = 0; i < missingTexts.length; i += chunkSize) {
                const chunk = missingTexts.slice(i, i + chunkSize);
                await this.processChunk(chunk, sourceLang, targetLang);
            }

            this.saveCache();
        }

        // Return all translations (cached + new)
        return texts.map(t => this.get(t, targetLang) || t);
    }

    async processChunk(texts, sourceLang, targetLang) {
        const prompt = `
      You are a professional website translator.
      Translate the following array of texts from ${sourceLang} into ${targetLang}.

Rules:
1. Maintain the tone and style of the original text.
      2. Preserve all HTML entities, variables, or special characters exactly as they are.
      3. Do not translate proper names or technical terms that should remain in the original language.
      4. Return ONLY a JSON array of strings.
      
      Input texts:
      ${JSON.stringify(texts)}
`;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const translations = JSON.parse(jsonStr);

            if (Array.isArray(translations) && translations.length === texts.length) {
                texts.forEach((original, index) => {
                    this.set(original, translations[index], targetLang);
                });
                console.log(`✅ Added ${texts.length} translations to cache for language: ${targetLang}`);
            } else {
                console.error("Mismatch in translation count or format from Gemini");
                console.error(`Expected ${texts.length} translations, got:`, translations);
            }
        } catch (error) {
            console.error("Translation error:", error);
            // Don't throw, just skip saving this chunk so we can retry later
        }
    }
}
