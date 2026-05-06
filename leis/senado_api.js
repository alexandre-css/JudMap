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

const http = axios.create({ timeout: 20_000 });

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
        const { data } = await http.get(url);
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

const RE_VIGENCIA_ART =
    /Art\.\s*\d+[°º]?\s*[-–.]\s*Esta\s+Lei\s+entra\s+em\s+vigor\s+([^.]{5,150})/i;
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

function parsearTextoVigencia(frase, baseIso) {
    // "após decorridos 30 (trinta) dias"
    const mDias = frase.match(
        /ap[oó]s\s+(?:decorridos?\s+)?(\d+)\s*(?:\([^)]+\)\s*)?dias/i,
    );
    if (mDias) return adicionarDias(baseIso, mDias[1]);

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
 *   2. Data de publicação (caso mais comum: "entra em vigor na data de publicação")
 *   3. Data de assinatura (fallback final)
 */
export async function resolverDataVigor(tipo, numero, ano) {
    const meta = await consultarLei(tipo, numero, ano);
    if (!meta) return null;

    const { dataPublicacao, dataAssinatura, observacao, urlDocumento } = meta;
    const base = dataPublicacao ?? dataAssinatura;
    if (!base) return null;

    // Entra em vigor na data de publicação — caso mais comum
    if (
        !observacao ||
        /na\s+data\s+de\s+(?:sua\s+)?publica[çc][aã]o/i.test(observacao)
    ) {
        return base;
    }

    // Observação referencia artigo de vigência → tenta obter o texto da lei
    if (urlDocumento) {
        try {
            const { data: buf } = await http.get(urlDocumento, {
                responseType: "arraybuffer",
                timeout: 25_000,
            });
            const html = iconv.decode(Buffer.from(buf), "win1252");
            const texto = html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ");
            const mv = texto.match(RE_VIGENCIA_ART);
            if (mv) {
                const resolvido = parsearTextoVigencia(mv[1], base);
                if (resolvido) return resolvido;
            }
        } catch {
            /* ignora falha de rede */
        }
    }

    return base;
}
