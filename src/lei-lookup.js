/**
 * Lookup de penas abstratas e texto de artigos a partir do dispositivoLegal.
 * Usa leis/index_penas.json (gerado por leis/build_index.js) e leis/rag/*.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const LEIS_DIR = path.join(__dir, "..", "leis");

// ── Carregamento lazy ─────────────────────────────────────────────────────────

let _indice = null;
let _ragCache = {};

function indice() {
    if (!_indice) {
        _indice = JSON.parse(
            fs.readFileSync(path.join(LEIS_DIR, "index_penas.json"), "utf8"),
        );
    }
    return _indice;
}

function ragLei(slug) {
    if (!_ragCache[slug]) {
        const p = path.join(LEIS_DIR, "rag", slug + ".json");
        if (!fs.existsSync(p)) return null;
        _ragCache[slug] = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    return _ragCache[slug];
}

// ── Mapeamento de identificadores de lei → slug ───────────────────────────────
// Cobre: número da lei, sigla, nome comum

const LEI_MAP = [
    // Códigos
    {
        slugs: ["codigo_penal"],
        match: /\b(c[oó]digo\s+penal|(?:dec\.?-?lei|dl)\s*2848|\bCP\b)(?!\s+militar)/i,
    },
    {
        slugs: ["codigo_penal_militar"],
        match: /\b(c[oó]digo\s+penal\s+militar|dec\.?-?lei\s*1001|\bCPM\b)/i,
    },
    {
        slugs: ["codigo_processo_penal"],
        match: /\b(c[oó]digo\s+de\s+processo\s+penal|dec\.?-?lei\s*3689|\bCPP\b)(?!\s+militar)/i,
    },
    {
        slugs: ["codigo_processo_penal_militar"],
        match: /\b(c[oó]digo\s+de\s+processo\s+penal\s+militar|dec\.?-?lei\s*1002|\bCPPM\b)/i,
    },
    {
        slugs: ["codigo_transito_brasileiro"],
        match: /\b(c[oó]digo\s+de\s+tr[aâ]nsito|9\.?503|\bCTB\b)/i,
    },
    // Leis por número
    {
        slugs: ["lei_drogas"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?11\.?343|lei\s+de\s+drogas|antidrogas)/i,
    },
    {
        slugs: ["estatuto_desarmamento"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?10\.?826|estatuto\s+do\s+desarmamento)/i,
    },
    {
        slugs: ["lei_crimes_hediondos"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?8\.?072|crimes?\s+hediondos)/i,
    },
    {
        slugs: ["lei_crime_organizado"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?12\.?850|organiza[cç][aã]o\s+criminosa)/i,
    },
    {
        slugs: ["lei_maria_da_penha"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?11\.?340|maria\s+da\s+penha)/i,
    },
    {
        slugs: ["lei_lavagem_dinheiro"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?9\.?613|lavagem\s+de\s+(?:dinheiro|capitais))/i,
    },
    {
        slugs: ["lei_interceptacao_telefonica"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?9\.?296|intercepta[cç][aã]o\s+telef)/i,
    },
    {
        slugs: ["lei_execucao_penal"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?7\.?210|\bLEP\b|execu[cç][aã]o\s+penal)/i,
    },
    {
        slugs: ["lei_crimes_ambientais"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?9\.?605|crimes?\s+ambientais)/i,
    },
    {
        slugs: ["eca"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?8\.?069|\bECA\b|estatuto\s+da\s+crian[cç]a)/i,
    },
    {
        slugs: ["lei_abuso_autoridade"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?13\.?869|abuso\s+de\s+autoridade)/i,
    },
    {
        slugs: ["lei_prisao_temporaria"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?7\.?960|pris[aã]o\s+tempor[aá]ria)/i,
    },
    {
        slugs: ["lei_henry_borel"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?14\.?344|henry\s+borel)/i,
    },
    {
        slugs: ["lei_crimes_ordem_tributaria"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?8\.?137|crimes?\s+(?:contra\s+a\s+ordem\s+tribut|tribut))/i,
    },
    {
        slugs: ["lei_crimes_sistema_financeiro"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?7\.?492|sistema\s+financeiro)/i,
    },
    {
        slugs: ["lei_contravencoes_penais"],
        match: /\b(dec\.?-?lei\s*3\.?688|contrave[nñ][cç][oõ]es\s+penais|\bLCP\b)/i,
    },
    {
        slugs: ["pacote_anticrime"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?13\.?964|pacote\s+anticrime)/i,
    },
    {
        slugs: ["lei_identificacao_criminal"],
        match: /\b(lei\s+(?:n[ºo°]?\s*)?12\.?037|identifica[cç][aã]o\s+criminal)/i,
    },
];

// ── Normalização de chave de artigo ───────────────────────────────────────────

function normalizarArtKey(artStr) {
    if (!artStr) return null;
    // "121-A" → "art_121_a", "121A" → "art_121_a", "33" → "art_33"
    return (
        "art_" +
        artStr
            .trim()
            .toLowerCase()
            .replace(/[ºo°]/g, "")
            .replace(/-([a-z])/g, "_$1") // com traço:  "121-a" → "121_a"
            .replace(/([0-9])([a-z])/g, "$1_$2") // sem traço:  "121a"  → "121_a"
            .replace(/[^a-z0-9_]/g, "")
    );
}

function normalizarParagrafo(parStr) {
    if (!parStr) return null;
    // "§2°-A" → "§2º-A", "§1°" → "§1º"
    return (
        "§" +
        parStr
            .trim()
            .replace(/[o°]/g, "º")
            .replace(/\s+/g, "")
            .toUpperCase()
            .replace(/^§/, "")
    );
}

// ── Parse do dispositivoLegal ─────────────────────────────────────────────────

export function parsearDispositivo(dispositivoLegal) {
    if (!dispositivoLegal || typeof dispositivoLegal !== "string") return null;

    const txt = dispositivoLegal;

    // 1. Identificar lei
    let slug = null;
    for (const { slugs, match } of LEI_MAP) {
        if (match.test(txt)) {
            slug = slugs[0];
            break;
        }
    }
    if (!slug) return null;

    // 2. Extrair número do artigo
    // Cobre: art., artigo, artigos, arts. + sufixo com traço (33-A) ou sem (33A)
    const artM = txt.match(/art(?:igos?|s)?\.?\s*(\d+(?:-?[A-Za-z])?)/i);
    if (!artM) return null;
    const artKey = normalizarArtKey(artM[1]);

    // 3. Extrair parágrafo (opcional)
    const parM = txt.match(/§\s*(\d+[ºo°]?(?:-[A-Z])?)/i);
    const paragrafo = parM ? "§" + parM[1].replace(/[o°]/g, "º") : null;

    return { slug, artKey, paragrafo };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Retorna a pena abstrata de um dispositivo legal.
 * @param {string} dispositivoLegal — ex: "art. 33, caput, Lei 11.343/2006"
 * @returns {{ tipo, minAnos, minMeses, maxAnos, maxMeses, multaMin?, multaMax? } | null}
 */
export function lookupPena(dispositivoLegal) {
    const parsed = parsearDispositivo(dispositivoLegal);
    if (!parsed) return null;

    const { slug, artKey, paragrafo } = parsed;
    const artInfo = indice()[slug]?.artigos?.[artKey];
    if (!artInfo) return null;

    // Se pediu § específico e ele existe no índice, retorna o §
    if (paragrafo && artInfo.paragrafos?.[paragrafo]) {
        return artInfo.paragrafos[paragrafo];
    }

    // Retorna pena do caput (sem o campo paragrafos)
    const { paragrafos: _, ...penaCaput } = artInfo;
    return penaCaput;
}

/**
 * Retorna o texto completo do artigo (do RAG).
 * @param {string} dispositivoLegal
 * @returns {string | null}
 */
export function lookupTextoArtigo(dispositivoLegal) {
    const parsed = parsearDispositivo(dispositivoLegal);
    if (!parsed) return null;

    const { slug, artKey } = parsed;
    const rag = ragLei(slug);
    const entry = rag?.normas?.[artKey];
    return entry?.texto ?? entry ?? null;
}

/**
 * Converte a pena do índice em dias (para usar no calculator).
 * @param {{ minAnos, minMeses, maxAnos, maxMeses }} pena
 * @returns {{ minDias, maxDias }}
 */
export function penaTotalDias(pena) {
    if (!pena) return null;
    const minDias = (pena.minAnos ?? 0) * 365 + (pena.minMeses ?? 0) * 30;
    const maxDias = (pena.maxAnos ?? 0) * 365 + (pena.maxMeses ?? 0) * 30;
    return { minDias, maxDias };
}

/**
 * Lista todos os slugs de lei disponíveis no índice.
 */
export function leisDisponiveis() {
    return Object.keys(indice());
}
