#!/usr/bin/env node
/**
 * Extrator histórico de alterações legislativas — JudMap
 *
 * Para cada lei que possua `urlHistorico`, baixa o HTML do Planalto
 * (versão não-compilada, com redações antigas em texto riscado), detecta
 * alterações de pena por artigo e gera um rascunho de entradas para
 * `leis/historico_legislativo.json`.
 *
 * O que este módulo FAZ:
 *   • Identifica texto riscado (<strike>, <s>, <del>, style="line-through")
 *   • Extrai penas antigas (riscadas) e novas (vigentes) por artigo
 *   • Lê a anotação editorial "(Redação dada pela Lei nº X, de YYYY)"
 *   • Consulta a API do Senado para obter dataVigor da lei modificadora
 *   • Compara penas e classifica o tipo de alteração
 *   • Emite JSON com flag "autoExtraido: true" para revisão humana posterior
 *
 * O que este módulo NÃO FAZ (por design):
 *   • Não detecta alterações bifaciais dentro do mesmo §  (exige análise por dispositivo)
 *   • Não resolve casos onde a anotação está faltando no HTML
 *   • Não substitui o historico_legislativo.json manual — apenas o alimenta
 *
 * Uso:
 *   node leis/extrator_historico.js                       # todas as leis com urlHistorico
 *   node leis/extrator_historico.js codigo_penal          # só uma lei
 *   node leis/extrator_historico.js --out resultado.json  # salva em arquivo
 *   node leis/extrator_historico.js --merge               # mescla com historico_legislativo.json existente
 */

import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { baixarHtmlComRetry, LEIS } from "./extrator.js";
import { parsearAnotacao, resolverDataVigor } from "./senado_api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORICO_PATH = path.join(__dirname, "historico_legislativo.json");

// ─── Sentinelas para texto riscado ────────────────────────────────────────────
// Usamos chars raros (controle ASCII) que jamais aparecem no texto legal
const S_ABRE = "\x01";
const S_FECHA = "\x02";

// ─── Dicionário de número por extenso → inteiro ───────────────────────────────
const PALAVRAS_NUM = {
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    três: 3,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    quatorze: 14,
    catorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezessete: 17,
    dezoito: 18,
    dezenove: 19,
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    setenta: 70,
    oitenta: 80,
    noventa: 90,
    cem: 100,
    cento: 100,
};

function palavraParaNum(str) {
    if (!str) return null;
    const s = str
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    if (/^\d[\d.]*$/.test(s)) return parseInt(s.replace(/\./g, ""));
    const partes = s.split(/\s+e\s+/);
    let total = 0;
    for (const p of partes) {
        const v = PALAVRAS_NUM[p.trim()];
        if (v === undefined) return null;
        total += v;
    }
    return total || null;
}

// ─── Parsing de pena ──────────────────────────────────────────────────────────
const RE_TIPO_PENA = /\b(reclus[aã]o|deten[cç][aã]o|pris[aã]o\s+simples)\b/i;
const NUM_RE =
    "(?:(\\d[\\d.]*)|([a-záàâãéêíóôõúüç]+(?:\\s+e\\s+[a-záàâãéêíóôõúüç]+)*))";
const RE_FAIXA = new RegExp(
    `de\\s+${NUM_RE}\\s+(?:\\([^)]+\\)\\s+)?(mes(?:es)?|ano[s]?)\\s+a\\s+${NUM_RE}\\s+(?:\\([^)]+\\)\\s+)?(mes(?:es)?|ano[s]?)`,
    "i",
);
const RE_SO_ANOS = new RegExp(
    `de\\s+${NUM_RE}\\s+(?:\\([^)]+\\)\\s+)?a\\s+${NUM_RE}\\s+(?:\\([^)]+\\)\\s+)?ano`,
    "i",
);

function parseVal(numStr, palavraStr) {
    if (numStr) return parseInt(numStr.replace(/\./g, ""));
    return palavraParaNum(palavraStr);
}

/** Extrai { tipo, minAnos, minMeses, maxAnos, maxMeses } de um trecho de pena. */
export function parsearPena(texto) {
    if (!texto) return null;
    const tipoM = texto.match(RE_TIPO_PENA);
    if (!tipoM) return /multa/i.test(texto) ? { tipo: "multa" } : null;

    const tipo = tipoM[1]
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");

    const result = {
        tipo,
        minAnos: null,
        minMeses: null,
        maxAnos: null,
        maxMeses: null,
    };

    const m1 = texto.match(RE_FAIXA);
    if (m1) {
        const valMin = parseVal(m1[1], m1[2]);
        const valMax = parseVal(m1[4], m1[5]);
        if (m1[3].toLowerCase().startsWith("mes")) {
            result.minAnos = 0;
            result.minMeses = valMin;
        } else {
            result.minAnos = valMin;
            result.minMeses = 0;
        }
        if (m1[6].toLowerCase().startsWith("mes")) {
            result.maxAnos = 0;
            result.maxMeses = valMax;
        } else {
            result.maxAnos = valMax;
            result.maxMeses = 0;
        }
        return result;
    }

    const m2 = texto.match(RE_SO_ANOS);
    if (m2) {
        result.minAnos = parseVal(m2[1], m2[2]) ?? 0;
        result.minMeses = 0;
        result.maxAnos = parseVal(m2[3], m2[4]) ?? 0;
        result.maxMeses = 0;
        return result;
    }

    return null;
}

function emMeses(pena) {
    if (!pena) return null;
    return {
        min: (pena.minAnos ?? 0) * 12 + (pena.minMeses ?? 0),
        max: (pena.maxAnos ?? 0) * 12 + (pena.maxMeses ?? 0),
    };
}

/** Classifica o tipo de alteração comparando pena anterior e nova. */
function classificarTipo(anterior, nova) {
    const pa = emMeses(anterior);
    const pn = emMeses(nova);
    if (!pa || !pn) return "novatio_legis_in_pejus";

    const maisPesado = pn.min > pa.min || pn.max > pa.max;
    const maisLeve = pn.min < pa.min || pn.max < pa.max;

    if (maisPesado && maisLeve) return "bifacial";
    if (maisPesado) return "novatio_legis_in_pejus";
    if (maisLeve) return "novatio_legis_in_mellius";
    return null; // pena idêntica: alteração redacional, será descartada
}

function lexMitiorDerivada(tipo) {
    if (tipo === "novatio_legis_in_mellius") return true;
    if (tipo === "bifacial") return "parcial";
    return false;
}

// ─── Processamento do HTML histórico ─────────────────────────────────────────

/** Marca texto riscado com sentinelas e devolve texto plano marcado. */
export function htmlParaTextoMarcado(html) {
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    // Substitui elementos riscados (processa do mais específico para o mais geral;
    // cheerio garante ordem de documento, mas como usamos replaceWith com texto,
    // elementos filhos já não são vistos após o pai ser substituído)
    //
    // IMPORTANTE: normalize whitespace interno com espaço simples para garantir que
    // a sentinela de abertura (\x01) e fechamento (\x02) fiquem na mesma linha após
    // split('\n'). Sem isso, um <strike> que envolve um artigo inteiro (com quebras
    // de linha internas) separaria os sentinelas em linhas diferentes, fazendo
    // eRiscada() retornar false para a pena antiga.
    $("strike, s, del").each((_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        $(el).replaceWith(t ? `${S_ABRE}${t}${S_FECHA}` : "");
    });
    $("[style]").each((_, el) => {
        if (
            ($(el).attr("style") || "").toLowerCase().includes("line-through")
        ) {
            const t = $(el).text().replace(/\s+/g, " ").trim();
            $(el).replaceWith(t ? `${S_ABRE}${t}${S_FECHA}` : "");
        }
    });

    return $("body")
        .text()
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{4,}/g, "\n\n");
}

// Regex de artigo: captura "Art. 157" ou "Art. 157-A"
const RE_ART_INICIO = /^Art\.\s*(\d+(?:-[A-Za-z])?)/;

// Regex de pena (linha que começa com "Pena –", "Pena -", "Penas –" ou "Penas -")
// O CTB usa "Penas" (plural); a maioria das leis usa "Pena" (singular)
const RE_PENA_LINHA = /^Penas?\s*[-–]/i;

// Regex de anotação editorial (redação dada, incluído por...)
const RE_ANOTACAO_EDITORIAL =
    /\((?:Redação\s+dada|Inclu[ií]d[ao]|Nova\s+redação\s+dada)[^)]{5,150}\)/i;

/**
 * Junta linhas que foram quebradas pelo HTML do Planalto.
 * Casos: penas longas, anotações editoriais, continuações de parágrafo.
 *
 * Regra:
 *   1. Parênteses abertos no buffer sem fechar → continua juntando (ignora conteúdo riscado)
 *   2. Próxima linha começa com letra minúscula ou dígito E o buffer < 400 chars → continua
 *   3. Caso contrário → empurra o buffer e começa novo
 */
function juntarLinhasQuebradas(linhas) {
    const out = [];
    let buf = "";

    // Conta parênteses NÃO cobertos por sentinelas (conteúdo riscado já está "selado")
    const contarParens = (s) => {
        const semRiscado = s.replace(
            new RegExp(`${S_ABRE}[^${S_FECHA}]*${S_FECHA}`, "g"),
            "",
        );
        const a = (semRiscado.match(/\(/g) || []).length;
        const f = (semRiscado.match(/\)/g) || []).length;
        return a - f; // positivo = parens abertos
    };

    for (const l of linhas) {
        if (!l) {
            if (buf) {
                out.push(buf);
                buf = "";
            }
            continue;
        }
        if (!buf) {
            buf = l;
            continue;
        }

        // Parênteses não fechados no buffer → join obrigatório (anotação multi-linha)
        // Limite de 150 chars: protege contra refs judiciais quebradas tipo "(Vide ADC" sem ")"
        if (contarParens(buf) > 0 && buf.length < 150) {
            buf += " " + l;
            continue;
        }

        // Próxima linha começa com letra MINÚSCULA ou dígito, e o buffer ainda é curto
        // (evita runaway joins quando um parágrafo longo absorve artigos seguintes)
        // ATENÇÃO: exclui intencionalmente § (U+00A7), º (U+00BA) e letras maiúsculas
        // acentuadas (U+00C0-U+00D6) que estão na range a-ÿ mas NÃO são continuações.
        const primeiroChar =
            l.replace(/\x01/g, "").replace(/^\s+/, "")[0] || "";
        const eContinuacao =
            /[a-záàâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ0-9]/.test(primeiroChar) &&
            buf.length < 250;
        if (eContinuacao) {
            buf += " " + l;
            continue;
        }

        // Pena truncada: buffer termina com dígito ("...de 12 (doze) a 24") e
        // próxima linha começa com '(' ("(vinte e quatro) anos."). Sem este
        // join, a regex de pena perde a unidade e o número fica solto.
        const bufLimpo = semMarcas(buf);
        if (
            primeiroChar === "(" &&
            /\d\s*$/.test(bufLimpo) &&
            buf.length < 250
        ) {
            buf += " " + l;
            continue;
        }

        out.push(buf);
        buf = l;
    }
    if (buf) out.push(buf);
    return out;
}

/** Normaliza o número do artigo para chave JSON (ex.: "157-A" → "157_a"). */
function normArtKey(id) {
    return `art_${id.toLowerCase().replace(/-/g, "_")}`;
}

/** Determina se uma linha (com sentinelas) é predominantemente riscada. */
function eRiscada(linha) {
    const marcado = (
        linha.match(new RegExp(`${S_ABRE}[^${S_FECHA}]*${S_FECHA}`, "g")) || []
    ).reduce((s, m) => s + m.length - 2, 0);
    const naoMarcado = linha
        .replace(new RegExp(`${S_ABRE}[^${S_FECHA}]*${S_FECHA}`, "g"), "")
        .replace(/\x01|\x02/g, "")
        .trim().length;
    return linha.startsWith(S_ABRE) || marcado > naoMarcado;
}

/** Remove sentinelas de um texto (devolve só o conteúdo visível). */
function semMarcas(texto) {
    return texto
        .replace(new RegExp(`${S_ABRE}([^${S_FECHA}]*)${S_FECHA}`, "g"), "$1")
        .replace(/\x01|\x02/g, "")
        .trim();
}

/**
 * Parseia o texto marcado e retorna Map<artKey, AlteracaoBruta[]>
 * onde AlteracaoBruta = { textoAnterior, textoNovo, anotacao }
 */
function extrairAlteracoesBrutas(textoMarcado) {
    const linhasBrutas = textoMarcado
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 3);

    const linhas = juntarLinhasQuebradas(linhasBrutas);

    const resultado = new Map(); // artKey → AlteracaoBruta[]

    let artAtual = null;
    let penasAntigas = []; // penas riscadas ainda não emparelhadas

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const linhaLimpa = semMarcas(linha);

        // Novo artigo → reseta estado quando muda o número de artigo
        const ma = linhaLimpa.match(RE_ART_INICIO);
        if (ma) {
            const novaChave = normArtKey(ma[1]);
            // Só reseta penasAntigas quando o artigo realmente muda.
            // Se é o mesmo artigo (ex.: artigo inteiro riscado + nova versão),
            // mantém as penas antigas coletadas.
            if (novaChave !== artAtual) penasAntigas = [];
            artAtual = novaChave;

            // Caso especial: a linha riscada pode ser o artigo INTEIRO (header + corpo + pena).
            // Nesse caso o header detecta o artigo mas a pena nunca chega a uma linha própria.
            // Extrai a pena diretamente desta linha se ela for riscada.
            if (eRiscada(linha) && /Penas?\s*[-–]/i.test(linhaLimpa)) {
                const mPena = linhaLimpa.match(/Penas?\s*[-–].+/i);
                if (mPena) penasAntigas.push(mPena[0].trim());
            }
            continue;
        }

        if (!artAtual) continue;

        // Só processa linhas que contenham uma "Pena"
        if (!RE_PENA_LINHA.test(linhaLimpa)) continue;

        const riscada = eRiscada(linha);

        if (riscada) {
            // Pena da redação anterior — guarda para emparelhar com a próxima pena nova
            penasAntigas.push(linhaLimpa);
        } else {
            // Pena da redação nova — busca anotação na mesma linha ou nas 2 próximas
            let anotacao = "";
            const mInline = linhaLimpa.match(RE_ANOTACAO_EDITORIAL);
            if (mInline) {
                anotacao = mInline[0];
            } else {
                for (let k = 1; k <= 2; k++) {
                    if (i + k >= linhas.length) break;
                    const prox = semMarcas(linhas[i + k]);
                    const mProx = prox.match(RE_ANOTACAO_EDITORIAL);
                    if (mProx) {
                        anotacao = mProx[0];
                        break;
                    }
                }
            }

            // Emparelha com a pena antiga mais recente (se houver)
            if (anotacao && penasAntigas.length > 0) {
                const anterior = penasAntigas[penasAntigas.length - 1];
                const nova = linhaLimpa
                    .replace(RE_ANOTACAO_EDITORIAL, "")
                    .trim();

                if (!resultado.has(artAtual)) resultado.set(artAtual, []);
                resultado.get(artAtual).push({
                    textoAnterior: anterior,
                    textoNovo: nova,
                    anotacao,
                });

                // Descarta a pena antiga já emparelhada
                penasAntigas.splice(penasAntigas.length - 1, 1);
            }
        }
    }

    return resultado;
}

// ─── Cache de dataVigor (evita consultas repetidas à mesma lei) ───────────────
const cacheDataVigor = new Map();

async function obterDataVigor(anotacao) {
    const lei = parsearAnotacao(anotacao);
    if (!lei) return null;

    const chave = `${lei.tipo}/${lei.numero}/${lei.ano}`;
    if (cacheDataVigor.has(chave)) return cacheDataVigor.get(chave);

    // Pausa respeitosa para o rate-limit da API do Senado (≤10 req/s)
    await new Promise((r) => setTimeout(r, 120));

    const data = await resolverDataVigor(lei.tipo, lei.numero, lei.ano);
    cacheDataVigor.set(chave, data);
    return data;
}

// ─── Descrição automática ─────────────────────────────────────────────────────

function gerarDescricao(textoAnterior, textoNovo, penaAnt, penaNova) {
    if (!penaAnt || !penaNova)
        return `Alteração de pena. Anterior: "${textoAnterior}". Nova: "${textoNovo}".`;

    const partes = [];
    const minA = (penaAnt.minAnos ?? 0) * 12 + (penaAnt.minMeses ?? 0);
    const minN = (penaNova.minAnos ?? 0) * 12 + (penaNova.minMeses ?? 0);
    const maxA = (penaAnt.maxAnos ?? 0) * 12 + (penaAnt.maxMeses ?? 0);
    const maxN = (penaNova.maxAnos ?? 0) * 12 + (penaNova.maxMeses ?? 0);

    if (minN !== minA)
        partes.push(
            `pena mínima ${minN > minA ? "aumentada" : "reduzida"} de ${penaAnt.minAnos ?? penaAnt.minMeses + "m"} para ${penaNova.minAnos ?? penaNova.minMeses + "m"} ${penaAnt.minAnos != null ? "anos" : "meses"}`,
        );
    if (maxN !== maxA)
        partes.push(
            `pena máxima ${maxN > maxA ? "aumentada" : "reduzida"} de ${penaAnt.maxAnos ?? penaAnt.maxMeses + "m"} para ${penaNova.maxAnos ?? penaNova.maxMeses + "m"} ${penaAnt.maxAnos != null ? "anos" : "meses"}`,
        );
    if (partes.length === 0)
        partes.push("alteração sem mudança de pena mínima/máxima");

    return (
        partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("; ") +
        ". [AUTO]"
    );
}

// ─── Processamento de uma lei ─────────────────────────────────────────────────

/**
 * Extrai as alterações históricas de penas de uma lei e retorna o resultado
 * no formato de entrada para `historico_legislativo.json`.
 *
 * @param {object} leiConfig — entrada do array LEIS de extrator.js
 * @returns {object|null} — { [artKey]: { descricao, alteracoes[] } }
 */
export async function extrairHistoricoLei(leiConfig) {
    const { urlHistorico, nomeArquivo } = leiConfig;
    if (!urlHistorico) return null;

    console.log(`  [historico] ${nomeArquivo} — baixando ${urlHistorico}`);
    let html;
    try {
        html = await baixarHtmlComRetry(urlHistorico);
    } catch (e) {
        console.error(`  [ERRO] ${nomeArquivo}: ${e.message}`);
        return null;
    }

    const textoMarcado = htmlParaTextoMarcado(html);
    const brutas = extrairAlteracoesBrutas(textoMarcado);

    if (brutas.size === 0) {
        console.log(
            `  [historico] ${nomeArquivo} — nenhuma alteração detectada`,
        );
        return null;
    }

    const resultado = {};

    for (const [artKey, eventos] of brutas) {
        const alteracoes = [];

        for (const { textoAnterior, textoNovo, anotacao } of eventos) {
            const lei = parsearAnotacao(anotacao);
            if (!lei) continue;

            const penaAnt = parsearPena(textoAnterior);
            const penaNova = parsearPena(textoNovo);
            const tipo = classificarTipo(penaAnt, penaNova);
            if (!tipo) continue; // pena idêntica → alteração redacional sem impacto penal
            const dataVigor = await obterDataVigor(anotacao);

            // Formata penas para o JSON (remove campos nulos)
            const fmtPena = (p) => {
                if (!p) return null;
                const o = {};
                if (p.tipo) o.tipo = p.tipo;
                if (p.minAnos != null && p.minAnos > 0) o.minAnos = p.minAnos;
                if (p.minMeses != null && p.minMeses > 0)
                    o.minMeses = p.minMeses;
                if (p.maxAnos != null && p.maxAnos > 0) o.maxAnos = p.maxAnos;
                if (p.maxMeses != null && p.maxMeses > 0)
                    o.maxMeses = p.maxMeses;
                return Object.keys(o).length > 1 ? o : null;
            };

            const entrada = {
                lei: lei.nome,
                dataVigor: dataVigor ?? `${lei.ano}-??-??`,
                tipo,
                descricao: gerarDescricao(
                    textoAnterior,
                    textoNovo,
                    penaAnt,
                    penaNova,
                ),
                lexMitiorAplicavel: lexMitiorDerivada(tipo),
                autoExtraido: true,
            };

            const pa = fmtPena(penaAnt);
            const pn = fmtPena(penaNova);
            if (pa) entrada.penaAnterior = pa;
            if (pn) entrada.penaNova = pn;

            alteracoes.push(entrada);
            console.log(`    ${artKey}: ${lei.nome} → ${tipo}`);
        }

        if (alteracoes.length > 0) {
            resultado[artKey] = {
                descricao: `[AUTO] ${artKey.replace("art_", "Art. ")} — extraído de ${urlHistorico}`,
                alteracoes,
            };
        }
    }

    return Object.keys(resultado).length > 0 ? resultado : null;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const merge = args.includes("--merge");
    const outIdx = args.indexOf("--out");
    const outArg = outIdx !== -1 ? (args[outIdx + 1] ?? null) : null;
    // filtro posicional: primeiro arg que não seja flag nem valor de flag
    const flagsComValor = new Set(outIdx !== -1 ? [args[outIdx + 1]] : []);
    const filtro =
        args.find((a) => !a.startsWith("--") && !flagsComValor.has(a)) ?? null;

    const leisFiltradas = LEIS.filter(
        (l) => l.urlHistorico && (!filtro || l.nomeArquivo === filtro),
    );

    if (leisFiltradas.length === 0) {
        console.error(
            `Nenhuma lei com urlHistorico encontrada${filtro ? ` para "${filtro}"` : ""}.`,
        );
        process.exit(1);
    }

    console.log(
        `\n[extrator_historico] Processando ${leisFiltradas.length} lei(s)…\n`,
    );

    // Em modo --merge, prefere consumir o rascunho_historico.json existente
    // (que pode ter correções manuais aplicadas pelo usuário). Re-extrair
    // do zero perde essas correções silenciosamente.
    const RASCUNHO_PATH = path.join(__dirname, "rascunho_historico.json");
    let saida = {};
    if (merge) {
        try {
            saida = JSON.parse(await fs.readFile(RASCUNHO_PATH, "utf-8"));
            console.log(
                `[merge] Consumindo rascunho_historico.json existente ` +
                    `(${Object.keys(saida).length} lei(s) — pule '--merge' ` +
                    `e use '--out' para regenerar antes)\n`,
            );
        } catch {
            console.log("[merge] rascunho não encontrado — extraindo do zero\n");
        }
    }
    if (Object.keys(saida).length === 0) {
        for (const lei of leisFiltradas) {
            const resultado = await extrairHistoricoLei(lei);
            if (resultado) saida[lei.nomeArquivo] = resultado;
        }
    }

    if (merge) {
        // Mescla com historico_legislativo.json existente
        // — entradas já existentes (sem autoExtraido) têm prioridade
        const existente = JSON.parse(
            await fs.readFile(HISTORICO_PATH, "utf-8"),
        );
        for (const [nomeLei, artsNovos] of Object.entries(saida)) {
            if (!existente[nomeLei]) existente[nomeLei] = {};
            for (const [artKey, dadosNovos] of Object.entries(artsNovos)) {
                const artExist = existente[nomeLei][artKey];
                if (artExist) {
                    // Normaliza variações de nome: "Lei 14.994/2024" e "Lei nº
                    // 14.994/2024" devem ser identificadas como a mesma lei.
                    // Sem isso, entradas auto duplicariam as manuais.
                    const chaveLei = (nome) => {
                        const m = (nome || "").match(
                            /(\d[\d.]*)\s*[\/,].*?(\d{4})/,
                        );
                        return m
                            ? "L" + m[1].replace(/\./g, "") + "/" + m[2]
                            : nome;
                    };
                    const leisManuais = new Set(
                        (artExist.alteracoes ?? []).map((a) => chaveLei(a.lei)),
                    );
                    const novas = (dadosNovos.alteracoes ?? []).filter(
                        (a) => !leisManuais.has(chaveLei(a.lei)),
                    );
                    if (novas.length > 0) {
                        artExist.alteracoes = [
                            ...(artExist.alteracoes ?? []),
                            ...novas,
                        ];
                        console.log(
                            `  [merge] ${nomeLei}/${artKey}: +${novas.length} alteração(ões)`,
                        );
                    }
                } else {
                    existente[nomeLei][artKey] = dadosNovos;
                    console.log(`  [merge] ${nomeLei}/${artKey}: novo artigo`);
                }
            }
        }
        await fs.writeFile(
            HISTORICO_PATH,
            JSON.stringify(existente, null, 4),
            "utf-8",
        );
        console.log(`\n[OK] historico_legislativo.json atualizado.`);
    } else {
        const json = JSON.stringify(saida, null, 2);
        if (outArg) {
            await fs.writeFile(path.resolve(outArg), json, "utf-8");
            console.log(`\n[OK] Resultado salvo em ${outArg}`);
        } else {
            console.log("\n" + json);
        }
    }
}

// Executa se chamado diretamente
if (
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url))
) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
