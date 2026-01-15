/**
 * Supertonic 2 TTS Service for Read Aloud
 * 
 * This service handles communication between Read Aloud extension and Supertonic 2 TTS engine.
 * Communication is done via postMessage with the parent window (Read Aloud's player.js).
 */

// ONNX Runtime is loaded via CDN in index.html, available as global 'ort'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    // HuggingFace model paths - using CDN-friendly URL
    MODEL_BASE_URL: 'https://huggingface.co/Supertone/supertonic-2/resolve/main',
    ONNX_PATH: 'onnx',
    VOICE_STYLES_PATH: 'voice_styles',
    
    // Available voices
    VOICES: [
        { id: 'M1', name: 'Alex', gender: 'male', description: 'Lively, upbeat male voice with confident energy' },
        { id: 'M2', name: 'James', gender: 'male', description: 'Deep, robust male voice; calm and serious' },
        { id: 'M3', name: 'Robert', gender: 'male', description: 'Polished, authoritative male voice' },
        { id: 'M4', name: 'Sam', gender: 'male', description: 'Soft, neutral-toned male voice; gentle and approachable' },
        { id: 'M5', name: 'Daniel', gender: 'male', description: 'Warm, soft-spoken male voice; calm and soothing' },
        { id: 'F1', name: 'Sarah', gender: 'female', description: 'Calm female voice with a slightly low tone' },
        { id: 'F2', name: 'Lily', gender: 'female', description: 'Bright, cheerful female voice; lively and playful' },
        { id: 'F3', name: 'Jessica', gender: 'female', description: 'Clear, professional announcer-style female voice' },
        { id: 'F4', name: 'Olivia', gender: 'female', description: 'Crisp, confident female voice; distinct and expressive' },
        { id: 'F5', name: 'Emily', gender: 'female', description: 'Kind, gentle female voice; soft-spoken and soothing' },
    ],
    
    // Supported languages
    LANGUAGES: ['en', 'ko', 'es', 'pt', 'fr'],
    
    // Default settings
    DEFAULT_VOICE: 'M3',
    DEFAULT_LANG: 'en',
    DEFAULT_SPEED: 1.0,
    DEFAULT_STEPS: 5,
    SAMPLE_RATE: 24000,
};

// Language code mapping for Read Aloud compatibility
const LANG_MAP = {
    'en': 'en', 'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en',
    'ko': 'ko', 'ko-KR': 'ko',
    'es': 'es', 'es-ES': 'es', 'es-MX': 'es',
    'pt': 'pt', 'pt-BR': 'pt', 'pt-PT': 'pt',
    'fr': 'fr', 'fr-FR': 'fr', 'fr-CA': 'fr',
};

// ============================================================================
// Global State
// ============================================================================

let ttsEngine = null;
let isInitialized = false;
let isInitializing = false;
let currentUtterance = null;
let isPaused = false;
let isStopped = false;

// UI Elements
const statusText = document.getElementById('statusText');
const voicesContainer = document.getElementById('voicesContainer');
const voicesGrid = document.getElementById('voicesGrid');

// ============================================================================
// PostMessage Communication Layer
// ============================================================================

const MY_ADDRESS = 'supertonic-service';
const HOST_ADDRESS = 'supertonic-host';

/**
 * Send a message to the parent window (Read Aloud)
 */
function sendToHost(type, method, args = {}, id = null) {
    const message = {
        from: MY_ADDRESS,
        to: HOST_ADDRESS,
        type: type,
        method: method,
        args: args,
    };
    if (id) message.id = id;
    
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
    }
}

/**
 * Send a notification (no response expected)
 */
function notify(method, args = {}) {
    sendToHost('notification', method, args);
}

/**
 * Send a response to a request
 */
function respond(id, result, error = null) {
    const message = {
        from: MY_ADDRESS,
        to: HOST_ADDRESS,
        type: 'response',
        id: id,
        result: result,
        error: error,
    };
    
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
    }
}

/**
 * Handle incoming messages from Read Aloud
 */
window.addEventListener('message', async (event) => {
    const message = event.data;
    
    // Only process messages addressed to us
    if (message.to !== MY_ADDRESS) return;
    
    console.log('[Supertonic] Received:', message);
    
    if (message.type === 'request') {
        try {
            const result = await handleRequest(message.method, message.args || {});
            respond(message.id, result);
        } catch (error) {
            console.error('[Supertonic] Request error:', error);
            respond(message.id, null, error.message || String(error));
        }
    }
});

/**
 * Handle incoming requests
 */
async function handleRequest(method, args) {
    switch (method) {
        case 'speak':
            return await speak(args);
        case 'pause':
            return pause();
        case 'resume':
            return resume();
        case 'stop':
            return stop();
        case 'forward':
            return forward();
        case 'rewind':
            return rewind();
        case 'seek':
            return seek(args.index);
        case 'getVoices':
            return getVoices();
        default:
            throw new Error(`Unknown method: ${method}`);
    }
}

// ============================================================================
// TTS Engine
// ============================================================================

/**
 * Unicode Text Processor
 */
class UnicodeProcessor {
    constructor(indexer) {
        this.indexer = indexer;
    }

    call(textList, langList) {
        const processedTexts = textList.map((text, i) => this.preprocessText(text, langList[i]));
        
        const textIdsLengths = processedTexts.map(text => text.length);
        const maxLen = Math.max(...textIdsLengths);
        
        const textIds = processedTexts.map(text => {
            const row = new Array(maxLen).fill(0);
            for (let j = 0; j < text.length; j++) {
                const codePoint = text.codePointAt(j);
                row[j] = (codePoint < this.indexer.length) ? this.indexer[codePoint] : -1;
            }
            return row;
        });
        
        const textMask = this.getTextMask(textIdsLengths);
        return { textIds, textMask };
    }

    preprocessText(text, lang) {
        // Normalize unicode
        text = text.normalize('NFKD');

        // Remove emojis
        const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
        text = text.replace(emojiPattern, '');

        // Replace various dashes and symbols
        const replacements = {
            '–': '-', '‑': '-', '—': '-', '_': ' ',
            '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
            '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ',
            '#': ' ', '→': ' ', '←': ' ',
        };
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replaceAll(k, v);
        }

        // Remove special symbols
        text = text.replace(/[♥☆♡©\\]/g, '');

        // Replace known expressions
        text = text.replaceAll('@', ' at ');
        text = text.replaceAll('e.g.,', 'for example, ');
        text = text.replaceAll('i.e.,', 'that is, ');

        // Fix spacing around punctuation
        text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!');
        text = text.replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':');

        // Remove duplicate quotes and extra spaces
        while (text.includes('""')) text = text.replace('""', '"');
        while (text.includes("''")) text = text.replace("''", "'");
        text = text.replace(/\s+/g, ' ').trim();

        // Add period if needed
        if (!/[.!?;:,'"')\]}>…。」』】〉》›»]$/.test(text)) {
            text += '.';
        }

        // Wrap with language tags
        if (!CONFIG.LANGUAGES.includes(lang)) {
            lang = 'en';
        }
        text = `<${lang}>${text}</${lang}>`;

        return text;
    }

    getTextMask(textIdsLengths) {
        const maxLen = Math.max(...textIdsLengths);
        return this.lengthToMask(textIdsLengths, maxLen);
    }

    lengthToMask(lengths, maxLen = null) {
        const actualMaxLen = maxLen || Math.max(...lengths);
        return lengths.map(len => {
            const row = new Array(actualMaxLen).fill(0.0);
            for (let j = 0; j < Math.min(len, actualMaxLen); j++) {
                row[j] = 1.0;
            }
            return [row];
        });
    }
}

/**
 * Text-to-Speech Engine
 */
class TextToSpeech {
    constructor(cfgs, textProcessor, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt) {
        this.cfgs = cfgs;
        this.textProcessor = textProcessor;
        this.dpOrt = dpOrt;
        this.textEncOrt = textEncOrt;
        this.vectorEstOrt = vectorEstOrt;
        this.vocoderOrt = vocoderOrt;
        this.sampleRate = cfgs.ae.sample_rate;
        this.voiceStyles = {};
    }

    async loadVoiceStyle(voiceId) {
        if (this.voiceStyles[voiceId]) {
            return this.voiceStyles[voiceId];
        }

        const url = `${CONFIG.MODEL_BASE_URL}/${CONFIG.VOICE_STYLES_PATH}/${voiceId}.json`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load voice style: ${response.status}`);
        }
        const voiceStyle = await response.json();

        // Create tensors
        const ttlData = voiceStyle.style_ttl.data.flat(Infinity);
        const dpData = voiceStyle.style_dp.data.flat(Infinity);
        
        const ttlTensor = new ort.Tensor('float32', Float32Array.from(ttlData), voiceStyle.style_ttl.dims);
        const dpTensor = new ort.Tensor('float32', Float32Array.from(dpData), voiceStyle.style_dp.dims);

        this.voiceStyles[voiceId] = { ttl: ttlTensor, dp: dpTensor };
        return this.voiceStyles[voiceId];
    }

    async synthesize(text, lang, voiceId, totalStep = 5, speed = 1.0, onProgress = null) {
        const style = await this.loadVoiceStyle(voiceId);
        
        // Chunk text for long inputs
        const maxLen = lang === 'ko' ? 120 : 300;
        const chunks = this.chunkText(text, maxLen);
        
        let wavCat = [];
        let durCat = 0;
        const silenceDuration = 0.3;

        for (let i = 0; i < chunks.length; i++) {
            if (onProgress) {
                onProgress(i + 1, chunks.length);
            }

            const { wav, duration } = await this._infer([chunks[i]], [lang], style, totalStep, speed);
            
            if (wavCat.length === 0) {
                wavCat = wav;
                durCat = duration[0];
            } else {
                const silenceLen = Math.floor(silenceDuration * this.sampleRate);
                const silence = new Array(silenceLen).fill(0);
                wavCat = [...wavCat, ...silence, ...wav];
                durCat += duration[0] + silenceDuration;
            }
        }

        return { wav: wavCat, duration: [durCat] };
    }

    async _infer(textList, langList, style, totalStep, speed) {
        const bsz = textList.length;
        
        // Process text
        const { textIds, textMask } = this.textProcessor.call(textList, langList);
        
        const textIdsFlat = new BigInt64Array(textIds.flat().map(x => BigInt(x)));
        const textIdsShape = [bsz, textIds[0].length];
        const textIdsTensor = new ort.Tensor('int64', textIdsFlat, textIdsShape);
        
        const textMaskFlat = new Float32Array(textMask.flat(2));
        const textMaskShape = [bsz, 1, textMask[0][0].length];
        const textMaskTensor = new ort.Tensor('float32', textMaskFlat, textMaskShape);
        
        // Predict duration
        const dpOutputs = await this.dpOrt.run({
            text_ids: textIdsTensor,
            style_dp: style.dp,
            text_mask: textMaskTensor
        });
        const duration = Array.from(dpOutputs.duration.data);
        
        // Apply speed
        for (let i = 0; i < duration.length; i++) {
            duration[i] /= speed;
        }
        
        // Encode text
        const textEncOutputs = await this.textEncOrt.run({
            text_ids: textIdsTensor,
            style_ttl: style.ttl,
            text_mask: textMaskTensor
        });
        const textEmb = textEncOutputs.text_emb;
        
        // Sample noisy latent
        let { xt, latentMask } = this.sampleNoisyLatent(duration);
        
        const latentMaskFlat = new Float32Array(latentMask.flat(2));
        const latentMaskShape = [bsz, 1, latentMask[0][0].length];
        const latentMaskTensor = new ort.Tensor('float32', latentMaskFlat, latentMaskShape);
        
        const totalStepArray = new Float32Array(bsz).fill(totalStep);
        const totalStepTensor = new ort.Tensor('float32', totalStepArray, [bsz]);
        
        // Denoising loop
        for (let step = 0; step < totalStep; step++) {
            const currentStepArray = new Float32Array(bsz).fill(step);
            const currentStepTensor = new ort.Tensor('float32', currentStepArray, [bsz]);
            
            const xtFlat = new Float32Array(xt.flat(2));
            const xtShape = [bsz, xt[0].length, xt[0][0].length];
            const xtTensor = new ort.Tensor('float32', xtFlat, xtShape);
            
            const vectorEstOutputs = await this.vectorEstOrt.run({
                noisy_latent: xtTensor,
                text_emb: textEmb,
                style_ttl: style.ttl,
                latent_mask: latentMaskTensor,
                text_mask: textMaskTensor,
                current_step: currentStepTensor,
                total_step: totalStepTensor
            });
            
            const denoised = Array.from(vectorEstOutputs.denoised_latent.data);
            
            // Reshape
            const latentDim = xt[0].length;
            const latentLen = xt[0][0].length;
            xt = [];
            let idx = 0;
            for (let b = 0; b < bsz; b++) {
                const batch = [];
                for (let d = 0; d < latentDim; d++) {
                    const row = [];
                    for (let t = 0; t < latentLen; t++) {
                        row.push(denoised[idx++]);
                    }
                    batch.push(row);
                }
                xt.push(batch);
            }
        }
        
        // Generate waveform
        const finalXtFlat = new Float32Array(xt.flat(2));
        const finalXtShape = [bsz, xt[0].length, xt[0][0].length];
        const finalXtTensor = new ort.Tensor('float32', finalXtFlat, finalXtShape);
        
        const vocoderOutputs = await this.vocoderOrt.run({
            latent: finalXtTensor
        });
        
        const wav = Array.from(vocoderOutputs.wav_tts.data);
        
        return { wav, duration };
    }

    sampleNoisyLatent(duration) {
        const bsz = duration.length;
        const maxDur = Math.max(...duration);
        
        const wavLenMax = Math.floor(maxDur * this.sampleRate);
        const wavLengths = duration.map(d => Math.floor(d * this.sampleRate));
        
        const chunkSize = this.cfgs.ae.base_chunk_size * this.cfgs.ttl.chunk_compress_factor;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDimVal = this.cfgs.ttl.latent_dim * this.cfgs.ttl.chunk_compress_factor;
        
        const xt = [];
        for (let b = 0; b < bsz; b++) {
            const batch = [];
            for (let d = 0; d < latentDimVal; d++) {
                const row = [];
                for (let t = 0; t < latentLen; t++) {
                    const u1 = Math.max(0.0001, Math.random());
                    const u2 = Math.random();
                    const val = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                    row.push(val);
                }
                batch.push(row);
            }
            xt.push(batch);
        }
        
        const latentLengths = wavLengths.map(len => Math.floor((len + chunkSize - 1) / chunkSize));
        const latentMask = this.lengthToMask(latentLengths, latentLen);
        
        // Apply mask
        for (let b = 0; b < bsz; b++) {
            for (let d = 0; d < latentDimVal; d++) {
                for (let t = 0; t < latentLen; t++) {
                    xt[b][d][t] *= latentMask[b][0][t];
                }
            }
        }
        
        return { xt, latentMask };
    }

    lengthToMask(lengths, maxLen = null) {
        const actualMaxLen = maxLen || Math.max(...lengths);
        return lengths.map(len => {
            const row = new Array(actualMaxLen).fill(0.0);
            for (let j = 0; j < Math.min(len, actualMaxLen); j++) {
                row[j] = 1.0;
            }
            return [row];
        });
    }

    chunkText(text, maxLen) {
        const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim());
        const chunks = [];
        
        for (let paragraph of paragraphs) {
            paragraph = paragraph.trim();
            if (!paragraph) continue;
            
            const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/);
            
            let currentChunk = "";
            
            for (let sentence of sentences) {
                if (currentChunk.length + sentence.length + 1 <= maxLen) {
                    currentChunk += (currentChunk ? " " : "") + sentence;
                } else {
                    if (currentChunk) {
                        chunks.push(currentChunk.trim());
                    }
                    currentChunk = sentence;
                }
            }
            
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
        }
        
        return chunks.length > 0 ? chunks : [text];
    }
}

/**
 * Write WAV file
 */
function writeWavFile(audioData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = audioData.length * 2;
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    for (let i = 0; i < audioData.length; i++) {
        const clamped = Math.max(-1.0, Math.min(1.0, audioData[i]));
        view.setInt16(44 + i * 2, Math.floor(clamped * 32767), true);
    }
    
    return buffer;
}

// ============================================================================
// TTS Control Functions
// ============================================================================

/**
 * Initialize TTS Engine
 */
async function initializeTTS() {
    if (isInitialized || isInitializing) return;
    isInitializing = true;

    try {
        updateStatus('Loading ONNX Runtime...', 'loading');
        
        // Wait for ort to be available (loaded via CDN)
        let attempts = 0;
        while (typeof ort === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (typeof ort === 'undefined') {
            throw new Error('ONNX Runtime failed to load');
        }
        
        // Configure ONNX Runtime
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
        ort.env.wasm.numThreads = 1;
        
        const sessionOptions = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        };

        // Load config
        updateStatus('Loading configuration...', 'loading');
        const cfgsResponse = await fetch(`${CONFIG.MODEL_BASE_URL}/${CONFIG.ONNX_PATH}/tts.json`);
        if (!cfgsResponse.ok) {
            throw new Error(`Failed to load config: ${cfgsResponse.status}`);
        }
        const cfgs = await cfgsResponse.json();

        // Load text processor
        updateStatus('Loading text processor...', 'loading');
        const indexerResponse = await fetch(`${CONFIG.MODEL_BASE_URL}/${CONFIG.ONNX_PATH}/unicode_indexer.json`);
        if (!indexerResponse.ok) {
            throw new Error(`Failed to load indexer: ${indexerResponse.status}`);
        }
        const indexer = await indexerResponse.json();
        const textProcessor = new UnicodeProcessor(indexer);

        // Load ONNX models
        const modelNames = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'];
        const models = {};

        for (let i = 0; i < modelNames.length; i++) {
            const name = modelNames[i];
            updateStatus(`Loading model ${i + 1}/${modelNames.length}: ${name}...`, 'loading');
            const modelUrl = `${CONFIG.MODEL_BASE_URL}/${CONFIG.ONNX_PATH}/${name}.onnx`;
            models[name] = await ort.InferenceSession.create(modelUrl, sessionOptions);
        }

        // Create TTS engine
        ttsEngine = new TextToSpeech(
            cfgs,
            textProcessor,
            models['duration_predictor'],
            models['text_encoder'],
            models['vector_estimator'],
            models['vocoder']
        );

        isInitialized = true;
        isInitializing = false;

        updateStatus('Ready! Supertonic 2 TTS is loaded.', 'ready');
        displayVoices();

        // Advertise voices to Read Aloud
        advertiseVoices();

    } catch (error) {
        console.error('[Supertonic] Initialization error:', error);
        updateStatus(`Error: ${error.message}`, 'error');
        isInitializing = false;
    }
}

/**
 * Advertise available voices to Read Aloud
 */
function advertiseVoices() {
    const voices = CONFIG.VOICES.map(v => ({
        voiceName: `Supertonic ${v.name} (${v.id})`,
        lang: CONFIG.LANGUAGES.join(','),
        gender: v.gender,
        localService: true,
    }));

    notify('advertiseVoices', { voices });
    console.log('[Supertonic] Advertised voices:', voices);
}

/**
 * Get list of voices
 */
function getVoices() {
    return CONFIG.VOICES.map(v => ({
        voiceName: `Supertonic ${v.name} (${v.id})`,
        lang: CONFIG.LANGUAGES.join(','),
        gender: v.gender,
    }));
}

/**
 * Speak text
 */
async function speak(args) {
    if (!isInitialized) {
        throw new Error('TTS engine not initialized');
    }

    const { utterance, voiceName, lang, pitch, rate, volume } = args;
    
    // Parse voice ID from voice name
    let voiceId = CONFIG.DEFAULT_VOICE;
    if (voiceName) {
        const match = voiceName.match(/\(([MF]\d)\)/);
        if (match) {
            voiceId = match[1];
        }
    }

    // Map language
    let language = LANG_MAP[lang] || CONFIG.DEFAULT_LANG;
    if (!CONFIG.LANGUAGES.includes(language)) {
        language = CONFIG.DEFAULT_LANG;
    }

    // Speed from rate (0.5 to 2.0)
    const speed = rate || CONFIG.DEFAULT_SPEED;

    isStopped = false;
    isPaused = false;
    currentUtterance = { utterance, voiceId, language, speed };

    console.log('[Supertonic] Speaking:', { utterance: utterance.substring(0, 50) + '...', voiceId, language, speed });

    // Notify start
    notify('onStart', {});

    try {
        // Synthesize
        const { wav, duration } = await ttsEngine.synthesize(
            utterance,
            language,
            voiceId,
            CONFIG.DEFAULT_STEPS,
            speed
        );

        if (isStopped) {
            return;
        }

        // Create WAV blob
        const wavBuffer = writeWavFile(wav, ttsEngine.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });

        // Send audio to Read Aloud for playback
        notify('audioPlay', { src: blob, rate: 1.0, volume: volume || 1.0 });

        // Notify end after estimated duration
        const durationMs = duration[0] * 1000;
        setTimeout(() => {
            if (!isStopped) {
                notify('onEnd', {});
            }
        }, durationMs);

    } catch (error) {
        console.error('[Supertonic] Synthesis error:', error);
        notify('onError', { error: error.message });
        throw error;
    }
}

/**
 * Pause playback
 */
function pause() {
    if (currentUtterance && !isPaused) {
        isPaused = true;
        notify('audioPause', {});
    }
    return true;
}

/**
 * Resume playback
 */
function resume() {
    if (currentUtterance && isPaused) {
        isPaused = false;
        notify('audioResume', {});
    }
    return true;
}

/**
 * Stop playback
 */
function stop() {
    isStopped = true;
    isPaused = false;
    currentUtterance = null;
    return true;
}

/**
 * Forward (not implemented for TTS)
 */
function forward() {
    return true;
}

/**
 * Rewind (not implemented for TTS)
 */
function rewind() {
    return true;
}

/**
 * Seek to position (not implemented for TTS)
 */
function seek(index) {
    return true;
}

// ============================================================================
// UI Functions
// ============================================================================

function updateStatus(message, type) {
    if (statusText) {
        statusText.textContent = message;
        statusText.className = 'status-text ' + type;
    }
    console.log(`[Supertonic] ${type}: ${message}`);
}

function displayVoices() {
    if (!voicesContainer || !voicesGrid) return;

    voicesGrid.innerHTML = '';
    
    CONFIG.VOICES.forEach(voice => {
        const card = document.createElement('div');
        card.className = 'voice-card';
        card.innerHTML = `
            <div class="voice-name">${voice.name} (${voice.id})</div>
            <div class="voice-langs">${CONFIG.LANGUAGES.join(', ')}</div>
        `;
        voicesGrid.appendChild(card);
    });

    voicesContainer.classList.remove('hidden');
}

// ============================================================================
// Initialize on load
// ============================================================================

window.addEventListener('load', () => {
    initializeTTS();
});

// Also try to initialize immediately if DOM is ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeTTS();
}
