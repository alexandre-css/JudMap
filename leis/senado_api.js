/**
 * Cliente para a API de Dados Abertos Legislativos do Senado Federal
 * https://legis.senado.leg.br/dadosabertos/
 *
 * Exportações:
 *   parsearAnotacao(texto)                 → { tipo, numero, ano, nome } de anotações editoriais do Planalto
 *   consultarLei(tipo, numero, ano)        → metadados básicos da lei
 *   resolverDataVigor(tipo, numero, ano)   → melhor estimativa de dataVigor (YYYY-MM-DD)
 *
 * Limite da API: 10 req/s. O módulo respeita isso com um backoff simples.
 */

import axios from "axios";
import iconv from "iconv-lite";

const BASE = "https://legis.senado.leg.br/dadosabertos";

const http = axios.create({
    timeout: 20_000,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (compatible; JudMap-Extrator/1.0; +https://github.com/)",
    },
});

async function fetchComRetry(url, opts = {}, tentativas = 3) {
    for (let i = 1; i <= tentativas; i++) {
        try {
            return await http.get(url, opts);
        } catch (e) {
            const recuperavel =
                !e.response ||
                e.response.status >= 500 ||
                ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(e.code);
            if (!recuperavel || i === tentativas) throw e;
            await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
        }
    }
}

/**
 * Constrói lista de URLs do Planalto a tentar para uma lei ordinária federal.
 * As pastas `_ato{Y1}-{Y2}` do Planalto seguem mandatos presidenciais:
 *   2004-2006 (Lula1, parcial), 2007-2010, 2011-2014, 2015-2018, 2019-2022, 2023-2026.
 * Para leis ≤ 2003 o padrão é `/ccivil_03/leis/[{ano}/]L{num}.htm`.
 * Cada lei pode estar grafada como `L{num}` ou `l{num}`; tenta ambos.
 */
function planaltoUrlsLei(numero, ano) {
    const a = parseInt(ano, 10);
    if (!a) return [];

    let pasta = null;
    if (a >= 2023) pasta = "_ato2023-2026";
    else if (a >= 2019) pasta = "_ato2019-2022";
    else if (a >= 2015) pasta = "_ato2015-2018";
    else if (a >= 2011) pasta = "_ato2011-2014";
    else if (a >= 2007) pasta = "_ato2007-2010";
    else if (a >= 2004) pasta = "_ato2004-2006";

    const urls = [];
    if (pasta) {
        urls.push(
            `https://www.planalto.gov.br/ccivil_03/${pasta}/${ano}/lei/L${numero}.htm`,
            `https://www.planalto.gov.br/ccivil_03/${pasta}/${ano}/lei/l${numero}.htm`,
        );
    }
    // Fallbacks para leis antigas (≤ 2003) ou variações de path
    urls.push(
        `https://www.planalto.gov.br/ccivil_03/leis/${ano}/L${numero}.htm`,
        `https://www.planalto.gov.br/ccivil_03/leis/L${numero}.htm`,
        `https://www.planalto.gov.br/ccivil_03/leis/l${numero}.htm`,
    );
    return urls;
}

// DD/MM/YYYY → YYYY-MM-DD
function br2iso(data) {
    if (!data) return null;
    const [d, m, y] = data.split("/");
    if (!d || !m || !y) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function adicionarDias(iso, dias) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + parseInt(dias, 10));
    return d.toISOString().slice(0, 10);
}

// ─── Parsing de anotações editoriais do Planalto ──────────────────────────────
//
// Exemplos de texto de entrada:
//   "(Redação dada pela Lei nº 13.654, de 2018)"
//   "(Incluído pela Lei Complementar nº 105, de 2001)"
//   "(Redação dada pelo Decreto-Lei nº 2.848, de 1940)"
//   "(Redação dada pela Medida Provisória nº 2.187-13, de 2001)"
//   "(Redação dada pela Lei nº 15.397, de 2026)"

const RE_ANOTACAO =
    /(Lei(?:\s+Complementar)?|Decreto(?:-Lei)?|Medida\s+Provis[oó]ria)\s+n[°º.]\s*([\d.-]+),?\s+de\s+(\d{4})/i;

export function parsearAnotacao(texto) {
    if (!texto) return null;
    const m = texto.match(RE_ANOTACAO);
    if (!m) return null;

    const [, tipoStr, numStr, ano] = m;
    let tipo = "LEI";
    if (/complementar/i.test(tipoStr)) tipo = "LCP";
    else if (/decreto/i.test(tipoStr)) tipo = "DEL";
    else if (/medida/i.test(tipoStr)) tipo = "MPV";

    const numero = numStr.replace(/[.\-]/g, "").split("-")[0]; // "2.187-13" → "2187"

    return { tipo, numero, ano, nome: `${tipoStr.trim()} nº ${numStr}/${ano}` };
}

// ─── Consulta à API do Senado ─────────────────────────────────────────────────

/**
 * Retorna { dataAssinatura, dataPublicacao, observacao, urlDocumento } ou null.
 */
export async function consultarLei(tipo, numero, ano) {
    const url = `${BASE}/legislacao/${tipo}/${numero}/${ano}.json`;
    try {
        const { data } = await fetchComRetry(url);
        const docs = data?.DetalheDocumento?.documentos?.documento;
        const doc = Array.isArray(docs) ? docs[0] : docs;
        if (!doc) return null;

        const pubs = [doc.publicacoes?.publicacao ?? []].flat().filter(Boolean);
        const pubOriginal = pubs.find((p) => p.tipo === "PUB") ?? pubs[0];

        return {
            dataAssinatura: br2iso(doc.identificacao?.dataassinatura),
            dataPublicacao: br2iso(pubOriginal?.data),
            observacao: String(doc.observacao ?? ""),
            urlDocumento: doc.identificacao?.urlDocumento ?? null,
        };
    } catch {
        return null;
    }
}

// ─── Resolução de dataVigor ───────────────────────────────────────────────────

// Indicador ordinal: "º"/"°" (caractere) ou " o" (quando HTML usa <sup>o</sup>
// e o stripping de tags deixa "o" solto separado por espaço).
// Verbos: "entra" (presente, redação moderna) ou "entrará" (futuro, leis antigas).
const RE_VIGENCIA_ART =
    /Art\.\s*\d+(?:\s*[°º]|\s+o)?\s*[-–.]?\s*Esta\s+Lei\s+entra(?:r(?:á|ão))?\s+em\s+vigor\s+([^.]{5,300})/i;
// Dicionário simples de números por extenso (até "novecentos e noventa e nove")
const NUMEROS_EXTENSO = {
    um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
    quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
    noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300,
    quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700,
    oitocentos: 800, novecentos: 900,
};

function palavrasParaInt(s) {
    const norm = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .normalize("NFC");
    const tokens = norm.split(/\s+e\s+|\s+/).filter(Boolean);
    let total = 0;
    for (const t of tokens) {
        const v = NUMEROS_EXTENSO[t];
        if (v == null) return null;
        total += v;
    }
    return total || null;
}

const MESES_PT = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
};

export function parsearTextoVigencia(frase, baseIso) {
    // "após|depois decorridos 30 (trinta) dias da data de sua publicação"
    let m = frase.match(
        /(?:ap[oó]s|depois)\s+(?:decorridos?\s+)?(\d+)\s*(?:\([^)]+\)\s*)?dias/i,
    );
    if (m) return adicionarDias(baseIso, m[1]);

    // "45 (quarenta e cinco) dias após|depois (de) a sua publicação"
    m = frase.match(/(\d+)\s*(?:\([^)]+\)\s*)?dias\s+(?:ap[oó]s|depois)/i);
    if (m) return adicionarDias(baseIso, m[1]);

    // "no prazo de 90 dias"
    m = frase.match(/no\s+prazo\s+de\s+(\d+)\s*(?:\([^)]+\)\s*)?dias/i);
    if (m) return adicionarDias(baseIso, m[1]);

    // "após|depois decorridos cento e vinte dias" — vacatio por extenso
    m = frase.match(
        /(?:ap[oó]s|depois)\s+(?:decorridos?\s+)?([a-zçãõéíóúâêô\s]{4,40}?)\s+dias/i,
    );
    if (m) {
        const dias = palavrasParaInt(m[1]);
        if (dias) return adicionarDias(baseIso, dias);
    }

    // "em 23 de janeiro de 2020"
    const mData = frase.match(/em\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (mData) {
        const mesNorm = mData[2]
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        const mes = MESES_PT[mesNorm];
        if (mes)
            return `${mData[3]}-${String(mes).padStart(2, "0")}-${mData[1].padStart(2, "0")}`;
    }

    return null;
}

/**
 * Resolve a data de entrada em vigor (YYYY-MM-DD).
 * Ordem de tentativa:
 *   1. Artigo de vigência no texto da lei (vacatio legis explícito)
 *   2. Data de publicação (fallback — "entra em vigor na data de publicação")
 *   3. Data de assinatura (fallback final)
 *
 * Sempre tenta buscar o texto da lei: o campo `observacao` da API do Senado
 * é frequentemente vazio mesmo quando há vacatio legis (caso do Pacote
 * Anticrime, Lei 14.994/2024 etc.). Confiar nele gera dataVigor errada.
 */
export async function resolverDataVigor(tipo, numero, ano) {
    const meta = await consultarLei(tipo, numero, ano);
    if (!meta) return null;

    const { dataPublicacao, dataAssinatura, urlDocumento } = meta;
    const base = dataPublicacao ?? dataAssinatura;
    if (!base) return null;

    // Lista de URLs a tentar — em ordem. urlDocumento da API do Senado aponta
    // para normas.leg.br (SPA sem texto no HTML inicial) para leis recentes;
    // nesses casos o fallback Planalto é obrigatório.
    const urlsTentativa = [];
    if (urlDocumento && !urlDocumento.includes("normas.leg.br")) {
        urlsTentativa.push(urlDocumento);
    }
    if (tipo === "LEI") {
        urlsTentativa.push(...planaltoUrlsLei(numero, ano));
    }

    for (const url of urlsTentativa) {
        try {
            const { data: buf } = await fetchComRetry(url, {
                responseType: "arraybuffer",
                timeout: 25_000,
            });
            const html = iconv.decode(Buffer.from(buf), "win1252");
            const texto = html
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/\s+/g, " ");
            const mv = texto.match(RE_VIGENCIA_ART);
            if (mv) {
                const resolvido = parsearTextoVigencia(mv[1], base);
                if (resolvido) return resolvido;
            }
            // Se o texto foi obtido mas o regex não casou, não tenta mais URLs
            // (provavelmente a lei entra em vigor na publicação)
            return base;
        } catch {
            /* tenta próxima URL */
        }
    }

    return base;
}
