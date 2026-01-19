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
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
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
            // Reduced to 20 to improve stability with Flash Lite models
            const chunkSize = 20;
            for (let i = 0; i < missingTexts.length; i += chunkSize) {
                const chunk = missingTexts.slice(i, i + chunkSize);
                await this.processChunkWithRetry(chunk, sourceLang, targetLang);
                
                // Rate Limiting: Wait 4 seconds between chunks to avoid hitting 15 RPM limits
                if (i + chunkSize < missingTexts.length) {
                    console.log('⏳ Rate limiting: Waiting 4s before next batch...');
                    await new Promise(r => setTimeout(r, 4000));
                }
            }

            this.saveCache();
        }

        // Return all translations (cached + new)
        return texts.map(t => this.get(t, targetLang) || t);
    }

    async processChunkWithRetry(texts, sourceLang, targetLang, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this.processChunk(texts, sourceLang, targetLang);
                if (attempt > 1) {
                    console.log(`✅ Retry successful on attempt ${attempt}`);
                }
                return; // Success!
            } catch (error) {
                console.warn(`⚠️  Attempt ${attempt}/${retries} failed for chunk of ${texts.length} items.`);
                console.warn(`   Error: ${error.message}`); // Log specific error

                if (attempt === retries) {
                    // Adaptive splitting: If it fails, try splitting the chunk in half
                    if (texts.length > 1) {
                        console.log(`✂️  Splitting failing chunk of ${texts.length} items into two halves...`);
                        const mid = Math.floor(texts.length / 2);
                        const firstHalf = texts.slice(0, mid);
                        const secondHalf = texts.slice(mid);

                        // Recursively process the halves with a fresh set of retries
                        await this.processChunkWithRetry(firstHalf, sourceLang, targetLang, retries);
                        await this.processChunkWithRetry(secondHalf, sourceLang, targetLang, retries);
                    } else {
                        console.error("❌ Failed to translate item even after splitting down to single item.");
                        console.error("Item:", texts[0]);
                    }
                } else {
                    // Exponential backoff: 1s, 2s, 4s...
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.log(`⏳ Waiting ${delay}ms before retry...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
    }

    async processChunk(texts, sourceLang, targetLang) {
        const prompt = `
      You are a professional website translator.
      Translate the following array of texts from ${sourceLang} into ${targetLang}.

Rules:
1. Maintain the tone and style of the original text.
2. Preserve all HTML entities, variables, or special characters exactly as they are.
3. Translate all headings, buttons, navigation items, and UI elements (e.g., "Règlements" -> "Rules", "Accueil" -> "Home").
4. Only keep specific brand names (like "Espace Urbain Studio") in the original language.
5. Format currency correctly for the target language (e.g., "50$" -> "$50" in English).
6. Return ONLY a JSON array of strings.
7. CRITICAL: Preserve all leading and trailing whitespace from the source strings exactly in the translations. (e.g., " Hello " -> " Hola ")
      
      Input texts:
      ${JSON.stringify(texts)}
`;
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
            throw new Error(`Mismatch: Expected ${texts.length} translations, got ${translations.length}`);
        }
    }
}
