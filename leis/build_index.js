/**
 * Gera leis/index_penas.json a partir dos arquivos RAG JSON.
 * node leis/build_index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const RAG_DIR = path.join(__dir, 'rag');
const OUT = path.join(__dir, 'index_penas.json');

// ── Conversão de número por extenso → inteiro ─────────────────────────────────

const PALAVRAS = {
    'zero':0,'um':1,'uma':1,'dois':2,'duas':2,'três':3,'tres':3,'quatro':4,
    'cinco':5,'seis':6,'sete':7,'oito':8,'nove':9,'dez':10,'onze':11,'doze':12,
    'treze':13,'quatorze':14,'catorze':14,'quinze':15,'dezesseis':16,'dezessete':17,
    'dezoito':18,'dezenove':19,'vinte':20,'trinta':30,'quarenta':40,'cinquenta':50,
    'sessenta':60,'setenta':70,'oitenta':80,'noventa':90,'cem':100,'cento':100,
};

function palavraParaNum(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    if (/^\d[\d.,]*$/.test(s)) {
        return parseInt(s.replace(/\./g,'').replace(',','.'));
    }
    // composto: "vinte e um", "trinta e dois"
    const partes = s.split(/\s+e\s+/);
    let total = 0;
    for (const p of partes) {
        const v = PALAVRAS[p.trim()];
        if (v === undefined) return null;
        total += v;
    }
    return total || null;
}

// ── Parse de um trecho de pena ────────────────────────────────────────────────
// Cobre:
//   "reclusão, de seis a vinte anos"
//   "reclusão, de 5 (cinco) a 15 (quinze) anos"
//   "detenção, de três meses a um ano"
//   "detenção, de 3 (três) meses a 1 (um) ano"
//   "detenção, de 1 (um) a 3 (três) anos"
//   "multa" (só multa)
//   "reclusão, de 6 (seis) meses a 2 (dois) anos"

const RE_TIPO = /\b(reclus[aã]o|deten[cç][aã]o|pris[aã]o\s+simples)\b/i;

// Extrai valor numérico ou por extenso, incluindo parênteses: "5 (cinco)" ou "cinco"
const NUM = '(?:(\\d[\\d.]*)|([a-záàâãéêíóôõúüç]+(?:\\s+e\\s+[a-záàâãéêíóôõúüç]+)*))';
const RE_PENA = new RegExp(
    `de\\s+${NUM}\\s+(?:\\([^)]+\\)\\s+)?(mes(?:es)?|ano[s]?)\\s+a\\s+${NUM}\\s+(?:\\([^)]+\\)\\s+)?(mes(?:es)?|ano[s]?)`,
    'i'
);
// Casos com meses no mínimo e anos no máximo: "de 3 meses a 1 ano"
// ou "de 6 (seis) meses a 2 (dois) anos"

const RE_SO_ANOS = new RegExp(
    `de\\s+${NUM}\\s+(?:\\([^)]+\\)\\s+)?a\\s+${NUM}\\s+(?:\\([^)]+\\)\\s+)?ano`,
    'i'
);

const RE_MULTA_DIAS = /pagamento\s+de\s+(\d[\d.]*)\s+(?:\([^)]+\)\s+)?a\s+(\d[\d.]*)\s+(?:\([^)]+\)\s+)?dias?[- ]multa/i;

function parseValor(numStr, palavraStr) {
    if (numStr) return parseInt(numStr.replace(/\./g, ''));
    return palavraParaNum(palavraStr);
}

function parsePenaTrecho(texto) {
    if (!texto) return null;
    const result = {};

    const tipoM = texto.match(RE_TIPO);
    if (!tipoM) {
        if (/multa/i.test(texto) && !/reclus|deten|pris/i.test(texto)) {
            return { tipo: 'multa' };
        }
        return null;
    }
    result.tipo = tipoM[1].toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '_');

    // Tenta padrão com unidade diferente min/max: "de X meses a Y anos"
    const m1 = texto.match(RE_PENA);
    if (m1) {
        const valMin = parseValor(m1[1], m1[2]);
        const unMin = m1[3].toLowerCase();
        const valMax = parseValor(m1[4], m1[5]);
        const unMax = m1[6].toLowerCase();

        if (unMin.startsWith('mes')) {
            result.minAnos = 0;
            result.minMeses = valMin;
        } else {
            result.minAnos = valMin;
            result.minMeses = 0;
        }

        if (unMax.startsWith('mes')) {
            result.maxAnos = 0;
            result.maxMeses = valMax;
        } else {
            result.maxAnos = valMax;
            result.maxMeses = 0;
        }
    } else {
        // Padrão só anos: "de X a Y anos"
        const m2 = texto.match(RE_SO_ANOS);
        if (m2) {
            result.minAnos = parseValor(m2[1], m2[2]);
            result.minMeses = 0;
            result.maxAnos = parseValor(m2[3], m2[4]);
            result.maxMeses = 0;
        }
    }

    if (result.minAnos == null && result.minMeses == null) return null;

    // Multa em dias
    const mm = texto.match(RE_MULTA_DIAS);
    if (mm) {
        result.multaMin = parseInt(mm[1].replace(/\./g, ''));
        result.multaMax = parseInt(mm[2].replace(/\./g, ''));
    }

    return result;
}

// ── Extrai todas as ocorrências de "Pena -" de um texto de artigo ─────────────
// Retorna array de { contexto, pena } onde contexto indica se é caput, §N, etc.

const RE_PAR_HEADER = /§\s*(\d+[ºo°]?(?:-[A-Z])?)/gi;
const RE_PENA_BLOCO = /Pena\s*[-–]\s*([^\n]{0,200})/gi;

function extrairPenas(textoArtigo) {
    const resultados = [];
    let match;

    // Mapear posição de cada § para saber a qual § cada Pena pertence
    const headers = [];  // { pos, label }
    RE_PAR_HEADER.lastIndex = 0;
    while ((match = RE_PAR_HEADER.exec(textoArtigo)) !== null) {
        headers.push({ pos: match.index, label: '§' + match[1].replace(/[ºo°]/g, 'º') });
    }

    RE_PENA_BLOCO.lastIndex = 0;
    while ((match = RE_PENA_BLOCO.exec(textoArtigo)) !== null) {
        const pos = match.index;
        const trecho = match[1];

        // Determina contexto: qual § está antes desta Pena?
        let contexto = 'caput';
        for (const h of headers) {
            if (h.pos < pos) contexto = h.label;
            else break;
        }

        const pena = parsePenaTrecho(trecho);
        if (pena) {
            resultados.push({ contexto, ...pena });
        }
    }

    return resultados;
}

// ── Slug da lei a partir do nome do arquivo ────────────────────────────────────
function slugLei(filename) {
    return path.basename(filename, '.json');
}

// ── Build principal ───────────────────────────────────────────────────────────

function build() {
    const indice = {};
    let totalArts = 0, totalComPena = 0;

    const arquivos = fs.readdirSync(RAG_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();

    for (const arquivo of arquivos) {
        const slug = slugLei(arquivo);
        const data = JSON.parse(fs.readFileSync(path.join(RAG_DIR, arquivo), 'utf8'));

        indice[slug] = {
            nome: data.nome ?? slug,
            fonte: data.fonte ?? null,
            dataExtracao: data.data_extracao ?? null,
            artigos: {},
        };

        for (const [artKey, val] of Object.entries(data.normas ?? {})) {
            const textoArt = typeof val === "string" ? val : val?.texto;
            totalArts++;
            const penas = extrairPenas(textoArt);
            if (penas.length === 0) continue;

            totalComPena++;
            // Separa pena do caput das dos §§
            const caput = penas.find(p => p.contexto === 'caput') ?? penas[0];
            const { contexto: _c, ...caputSemCtx } = caput;

            const entrada = { ...caputSemCtx };

            // §§ com pena própria
            const pars = penas.filter(p => p.contexto !== 'caput');
            if (pars.length > 0) {
                entrada.paragrafos = {};
                for (const { contexto, ...rest } of pars) {
                    entrada.paragrafos[contexto] = rest;
                }
            }

            indice[slug].artigos[artKey] = entrada;
        }
    }

    // Adicionar campo nome da lei a partir do JSON-LD (mais legível)
    const JSONLD_DIR = path.join(__dir, 'jsonld');
    for (const arquivo of fs.readdirSync(JSONLD_DIR).filter(f => f.endsWith('.jsonld'))) {
        const slug = path.basename(arquivo, '.jsonld');
        if (!indice[slug]) continue;
        try {
            const jld = JSON.parse(fs.readFileSync(path.join(JSONLD_DIR, arquivo), 'utf8'));
            if (jld.alternateName) indice[slug].nome = jld.alternateName;
        } catch { /* ignore */ }
    }

    fs.writeFileSync(OUT, JSON.stringify(indice, null, 2), 'utf8');

    console.log(`Leis indexadas: ${arquivos.length}`);
    console.log(`Artigos processados: ${totalArts}`);
    console.log(`Artigos com pena: ${totalComPena}`);
    console.log(`Saída: ${OUT}`);
}

build();
