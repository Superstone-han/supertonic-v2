/**
 * Cloudflare Worker for Supertonic 2 TTS Service
 * 
 * Handles:
 * 1. Static file serving with iframe-friendly headers
 * 2. Proxy requests to HuggingFace to bypass CORS
 */

const HF_BASE_URL = 'https://huggingface.co/Supertone/supertonic-2/resolve/main';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        
        // Proxy requests to HuggingFace
        if (url.pathname.startsWith('/hf/')) {
            return handleHFProxy(request, url);
        }
        
        // For static files, add iframe-friendly headers
        const response = await env.ASSETS.fetch(request);
        return addIframeHeaders(response);
    }
};

/**
 * Add headers to allow iframe embedding
 */
function addIframeHeaders(response) {
    const newHeaders = new Headers(response.headers);
    
    // Remove headers that block iframe embedding
    newHeaders.delete('X-Frame-Options');
    newHeaders.delete('Content-Security-Policy');
    
    // Allow embedding from any origin
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
    // Remove /hf/ prefix and construct HuggingFace URL
    const hfPath = url.pathname.replace('/hf/', '');
    const hfUrl = `${HF_BASE_URL}/${hfPath}`;
    
    try {
        // Fetch from HuggingFace
        const response = await fetch(hfUrl, {
            method: request.method,
            headers: {
                'User-Agent': 'Supertonic-TTS-Service/1.0',
            },
        });
        
        // Create new response with CORS headers
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', '*');
        newHeaders.delete('X-Frame-Options');
        
        // Handle preflight requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: newHeaders,
            });
        }
        
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}
