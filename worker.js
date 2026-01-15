/**
 * Cloudflare Worker for Supertonic 2 TTS Service
 */
const HF_BASE_URL = 'https://huggingface.co/Supertone/supertonic-2/resolve/main';
const CDN_BASE_URL = 'https://cdn.jsdelivr.net/npm';
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        
        // Proxy requests to HuggingFace
        if (url.pathname.startsWith('/hf/')) {
            return handleHFProxy(request, url);
        }
        
        // Proxy requests to CDN (for ONNX Runtime)
        if (url.pathname.startsWith('/cdn/')) {
            return handleCDNProxy(request, url);
        }
        
        // For static files, add iframe-friendly headers
        const response = await env.ASSETS.fetch(request);
        return addIframeHeaders(response);
    }
};
function addIframeHeaders(response) {
    const newHeaders = new Headers(response.headers);
    newHeaders.delete('X-Frame-Options');
    newHeaders.delete('Content-Security-Policy');
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    newHeaders.set('Cross-Origin-Opener-Policy', 'unsafe-none');
    
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}
async function handleHFProxy(request, url) {
    const hfPath = url.pathname.replace('/hf/', '');
    const hfUrl = `/`;
    
    try {
        const response = await fetch(hfUrl, {
            method: request.method,
            headers: { 'User-Agent': 'Supertonic-TTS-Service/1.0' },
        });
        
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.delete('X-Frame-Options');
        
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: newHeaders });
        }
        
        return new Response(response.body, {
            status: response.status,
            headers: newHeaders,
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
}
async function handleCDNProxy(request, url) {
    // /cdn/onnxruntime-web/ort.min.js -> jsdelivr CDN
    const cdnPath = url.pathname.replace('/cdn/', '');
    const cdnUrl = `/`;
    
    try {
        const response = await fetch(cdnUrl, {
            method: request.method,
            headers: { 'User-Agent': 'Supertonic-TTS-Service/1.0' },
        });
        
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Content-Type', 'application/javascript');
        
        return new Response(response.body, {
            status: response.status,
            headers: newHeaders,
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
}
