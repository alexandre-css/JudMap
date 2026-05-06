/**
 * Cliente unificado para 7 provedores de IA.
 * Adaptado do padrão eProbe (main.js linhas 13074–13365).
 * API keys via variáveis de ambiente ou arquivo .env na raiz.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

// Carrega .env da raiz se existir (sem dependência externa)
function carregarDotEnv() {
    const envPath = join(ROOT, ".env");
    if (!existsSync(envPath)) return;
    const linhas = readFileSync(envPath, "utf-8").split("\n");
    for (const linha of linhas) {
        const trimmed = linha.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx < 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed
            .slice(idx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) process.env[key] = val;
    }
}
carregarDotEnv();

const PROVIDERS = {
    google: {
        envKey: "JUDMAP_GOOGLE_KEY",
        modelo: "gemini-3-flash-preview",
    },
    anthropic: {
        envKey: "JUDMAP_ANTHROPIC_KEY",
        modelo: "claude-sonnet-4-6",
    },
    openai: {
        envKey: "JUDMAP_OPENAI_KEY",
        modelo: "gpt-4o-mini",
    },
    deepseek: {
        envKey: "JUDMAP_DEEPSEEK_KEY",
        modelo: "deepseek-chat",
    },
    meta: {
        envKey: "JUDMAP_GROQ_KEY",
        modelo: "meta-llama/llama-4-scout-17b-16e-instruct",
    },
    xai: {
        envKey: "JUDMAP_XAI_KEY",
        modelo: "grok-3-fast",
    },
    microsoft: {
        envKey: "JUDMAP_MICROSOFT_KEY",
        modelo: "gpt-4o",
    },
};

const ENDPOINTS_OPENAI_COMPAT = {
    openai: "https://api.openai.com/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions",
    meta: "https://api.groq.com/openai/v1/chat/completions",
    xai: "https://api.x.ai/v1/chat/completions",
    microsoft: "https://models.inference.ai.azure.com/chat/completions",
};

function resolverProvedor(nomeOuAuto) {
    if (nomeOuAuto && nomeOuAuto !== "auto") return nomeOuAuto;
    // Auto: usa o primeiro provider com chave configurada
    for (const [nome, cfg] of Object.entries(PROVIDERS)) {
        if (process.env[cfg.envKey]) return nome;
    }
    throw new Error(
        "Nenhum provider configurado. Defina uma variável como JUDMAP_ANTHROPIC_KEY.",
    );
}

function construirRequest(
    provider,
    modelo,
    apiKey,
    systemText,
    userText,
    genConfig = {},
) {
    const maxTokens = genConfig.maxTokens ?? 16384;
    const temperature = genConfig.temperature ?? 0.1;

    if (provider === "google") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature,
                responseMimeType: "application/json",
                // Limita thinking a 2048 tokens para não consumir o budget de output
                thinkingConfig: { thinkingBudget: 2048 },
            },
        };
        if (systemText)
            body.systemInstruction = { parts: [{ text: systemText }] };
        return { url, headers: { "Content-Type": "application/json" }, body };
    }

    if (provider === "anthropic") {
        const url = "https://api.anthropic.com/v1/messages";
        const body = {
            model: modelo,
            max_tokens: maxTokens,
            temperature,
            // Prompt caching: o system text é estático e pode ser cacheado
            system: [
                {
                    type: "text",
                    text: systemText ?? "",
                    cache_control: { type: "ephemeral" },
                },
            ],
            messages: [{ role: "user", content: userText }],
        };
        return {
            url,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "prompt-caching-2024-07-31",
            },
            body,
        };
    }

    // OpenAI-compatible
    const url = ENDPOINTS_OPENAI_COMPAT[provider];
    const messages = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    messages.push({ role: "user", content: userText });

    const body = {
        model: modelo,
        messages,
        max_tokens: maxTokens,
        temperature,
        response_format: { type: "json_object" },
    };
    return {
        url,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body,
    };
}

function extrairTexto(provider, data) {
    if (provider === "google") {
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        // thoughtSignature é metadado de raciocínio interno; não filtra — extrai text de todas as partes que o tenham
        return parts
            .filter((p) => p.text)
            .map((p) => p.text)
            .join("");
    }
    if (provider === "anthropic") {
        return (data?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
    }
    return data?.choices?.[0]?.message?.content ?? "";
}

// Retry com backoff exponencial para erros transientes (rate limit / indisponível)
const MAX_TENTATIVAS = 3;
const RETRY_STATUS = new Set([429, 503]);

async function fetchComRetry(url, init) {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        const resp = await fetch(url, init);
        if (!RETRY_STATUS.has(resp.status) || tentativa === MAX_TENTATIVAS)
            return resp;
        // Respeita Retry-After quando o servidor o informa; senão usa backoff 2s, 4s
        const retryAfter = parseInt(resp.headers.get("retry-after") ?? "0", 10);
        const espera = retryAfter > 0 ? retryAfter * 1000 : tentativa * 2000;
        process.stderr.write(
            `[JudMap] HTTP ${resp.status} — aguardando ${espera}ms (tentativa ${tentativa}/${MAX_TENTATIVAS})\n`,
        );
        await new Promise((r) => setTimeout(r, espera));
    }
}

/**
 * Chama a IA e retorna o texto bruto da resposta.
 * @param {string} systemText  - Prompt de sistema (estático/cacheável)
 * @param {string} userText    - Prompt do usuário (variável)
 * @param {object} options     - { provider, modelo, maxTokens, temperature }
 * @returns {{ texto: string, provider: string, modelo: string }}
 */
export async function chamarIA(systemText, userText, options = {}) {
    const providerNome = resolverProvedor(options.provider ?? "auto");
    const cfg = PROVIDERS[providerNome];
    if (!cfg) throw new Error(`Provider desconhecido: ${providerNome}`);

    const apiKey = process.env[cfg.envKey];
    if (!apiKey)
        throw new Error(
            `Chave ausente para ${providerNome}. Defina ${cfg.envKey}.`,
        );

    const modelo = options.modelo ?? cfg.modelo;
    const req = construirRequest(
        providerNome,
        modelo,
        apiKey,
        systemText,
        userText,
        options,
    );

    const resp = await fetchComRetry(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
    });

    if (!resp.ok) {
        const erro = await resp.text().catch(() => resp.statusText);
        throw new Error(`[${providerNome}] HTTP ${resp.status}: ${erro}`);
    }

    const data = await resp.json();
    const texto = extrairTexto(providerNome, data);
    if (!texto)
        throw new Error(
            `[${providerNome}] Resposta vazia ou formato inesperado.`,
        );

    return { texto, provider: providerNome, modelo };
}

export { PROVIDERS };
