/**
 * Ponto de entrada principal do JudMap.
 * extrair(texto, options) → { json, warnings, alertas, provider, modelo }
 */

import { buildPrompt, ENUM } from "./prompt-builder.js";
import { chamarIA } from "./ai-client.js";
import { validar } from "./validator.js";
import { calcularCamposDerivativos } from "./calculator.js";
import { parsearDispositivo } from "./lei-lookup.js";
import { verificarLeiTempoJSON } from "./lei-tempo.js";

// Extrai o JSON da resposta — lida com markdown code blocks e texto extra
function parsearRespostaIA(texto) {
    if (!texto) throw new Error("Resposta da IA está vazia.");

    // Remove blocos de markdown ```json ... ```
    let limpo = texto.trim();
    const match = limpo.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) limpo = match[1].trim();

    // Tenta parsear diretamente
    try {
        return JSON.parse(limpo);
    } catch (_) {
        /* vai tentar a seguir */
    }

    // Tenta encontrar o primeiro { ... } válido na string
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) {
        try {
            return JSON.parse(limpo.slice(inicio, fim + 1));
        } catch (_) {
            /* continua */
        }
    }

    // Detecta provável truncamento por overflow de tokens
    const parecesTruncado =
        limpo.trimStart().startsWith("{") && !limpo.trimEnd().endsWith("}");
    const sufixoTruncamento = parecesTruncado
        ? '\n[PROVÁVEL TRUNCAMENTO: resposta não fecha com "}" — tente aumentar maxTokens]'
        : "";
    throw new Error(
        `Não foi possível parsear JSON da resposta da IA.${sufixoTruncamento}\nResposta: ${texto.slice(0, 500)}`,
    );
}

/**
 * Extrai dados estruturados de um texto de sentença judicial.
 *
 * @param {string} textoSentenca  - Texto completo da sentença/acórdão
 * @param {object} options
 * @param {string} [options.provider='auto']  - Provider de IA ('anthropic', 'google', etc.)
 * @param {string} [options.modelo]           - Modelo específico (opcional)
 * @param {'grau1'|'grau2'|'completo'} [options.grau='grau1'] - Foco da extração
 * @param {number} [options.maxTokens=8192]   - Limite de tokens na resposta
 *
 * @returns {Promise<{ json: object, warnings: string[], alertas: string[], provider: string, modelo: string }>}
 */
export async function extrair(textoSentenca, options = {}) {
    const grau = options.grau ?? "grau1";

    // 1. Monta prompts
    const { systemText, userText } = buildPrompt(textoSentenca, grau);

    // 2. Chama IA
    const {
        texto: respostaIA,
        provider,
        modelo,
    } = await chamarIA(systemText, userText, options);

    // 3. Parse do JSON retornado
    const jsonBruto = parsearRespostaIA(respostaIA);

    // 4. Valida enums e coleta warnings
    const { json: jsonValidado, warnings, alertas } = validar(jsonBruto, ENUM);

    // 5. Calcula campos derivativos (totalDias, prescrição, súmulas)
    const jsonFinal = calcularCamposDerivativos(jsonValidado);

    // 6. Verifica lei penal no tempo — alertas de direito intertemporal
    const alertasLeiTempo = verificarLeiTempoJSON(
        jsonFinal,
        parsearDispositivo,
    );
    alertas.push(...alertasLeiTempo);

    // 7. Stampa metadados de extração
    if (jsonFinal.metadados) {
        jsonFinal.metadados.preenchidoPor = "ia";
        jsonFinal.metadados.modeloIA = `${provider}/${modelo}`;
        jsonFinal.metadados.ultimaExtracaoIA = new Date().toISOString();
    }

    return { json: jsonFinal, warnings, alertas, provider, modelo };
}
