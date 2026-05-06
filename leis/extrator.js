/**
 * Extrator de legislação brasileira — integrado ao JudMap
 *
 * Baixa leis do Planalto, decodifica Win-1252, remove revogados,
 * e grava três artefatos por lei:
 *   leis/rag/<nome>.json      — chunks compactos para embedding/RAG
 *   leis/jsonld/<nome>.jsonld — metadados schema.org/Legislation
 *   leis/md/<nome>.md         — texto limpo para leitura humana/NotebookLM
 *
 * Uso:
 *   node leis/extrator.js                   # extrai todas as leis
 *   node leis/extrator.js codigo_penal      # extrai apenas a lei indicada
 *   node leis/extrator.js --list            # lista as leis disponíveis
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import iconv from "iconv-lite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==========================================
// CONFIGURAÇÃO DAS LEIS
// ==========================================

// url         — versão compilada (texto consolidado atual; usada para RAG e lookup de artigos)
// urlHistorico — versão completa com todas as "Redações dadas" preservadas; fonte de verdade
//               para manutenção manual de historico_legislativo.json e para futuro extrator
//               histórico. Ausente quando a lei não tem versão compilada separada no Planalto.
export const LEIS = [
    {
        url: "http://www.planalto.gov.br/ccivil_03/Decreto-Lei/Del2848compilado.htm",
        urlHistorico:
            "https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848.htm",
        nomeArquivo: "codigo_penal",
        schema: {
            name: "Código Penal",
            alternateName: "Decreto-Lei nº 2.848/1940",
            legislationIdentifier:
                "Decreto-Lei nº 2.848, de 7 de dezembro de 1940",
            legislationType: "Decreto-Lei",
            datePublished: "1940-12-07",
            description:
                "Código Penal brasileiro. Consolidado com todas as alterações legislativas posteriores.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/decreto-lei/Del3689Compilado.htm",
        urlHistorico:
            "https://www.planalto.gov.br/ccivil_03/decreto-lei/Del3689.htm",
        nomeArquivo: "codigo_processo_penal",
        schema: {
            name: "Código de Processo Penal",
            alternateName: "Decreto-Lei nº 3.689/1941",
            legislationIdentifier:
                "Decreto-Lei nº 3.689, de 3 de outubro de 1941",
            legislationType: "Decreto-Lei",
            datePublished: "1941-10-03",
            description:
                "Código de Processo Penal brasileiro. Regula o processo e julgamento dos crimes definidos em lei.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/Del1001Compilado.htm",
        urlHistorico:
            "https://www.planalto.gov.br/ccivil_03/decreto-lei/Del1001.htm",
        nomeArquivo: "codigo_penal_militar",
        schema: {
            name: "Código Penal Militar",
            alternateName: "Decreto-Lei nº 1.001/1969",
            legislationIdentifier:
                "Decreto-Lei nº 1.001, de 21 de outubro de 1969",
            legislationType: "Decreto-Lei",
            datePublished: "1969-10-21",
            description: "Código Penal Militar brasileiro.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/Del1002Compilado.htm",
        urlHistorico:
            "https://www.planalto.gov.br/ccivil_03/decreto-lei/Del1002.htm",
        nomeArquivo: "codigo_processo_penal_militar",
        schema: {
            name: "Código de Processo Penal Militar",
            alternateName: "Decreto-Lei nº 1.002/1969",
            legislationIdentifier:
                "Decreto-Lei nº 1.002, de 21 de outubro de 1969",
            legislationType: "Decreto-Lei",
            datePublished: "1969-10-21",
            description: "Código de Processo Penal Militar brasileiro.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/lei/l11343.htm",
        nomeArquivo: "lei_drogas",
        schema: {
            name: "Lei de Drogas",
            alternateName: "Lei nº 11.343/2006",
            legislationIdentifier: "Lei nº 11.343, de 23 de agosto de 2006",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2006-08-23",
            description:
                "Institui o Sistema Nacional de Políticas Públicas sobre Drogas (Sisnad).",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/2003/L10.826compilado.htm",
        urlHistorico:
            "http://www.planalto.gov.br/ccivil_03/leis/2003/L10.826.htm",
        nomeArquivo: "estatuto_desarmamento",
        schema: {
            name: "Estatuto do Desarmamento",
            alternateName: "Lei nº 10.826/2003",
            legislationIdentifier: "Lei nº 10.826, de 22 de dezembro de 2003",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2003-12-22",
            description:
                "Dispõe sobre registro, posse e comercialização de armas de fogo e munição.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L8069Compilado.htm",
        urlHistorico: "http://www.planalto.gov.br/ccivil_03/leis/L8069.htm",
        nomeArquivo: "eca",
        schema: {
            name: "Estatuto da Criança e do Adolescente",
            alternateName: "Lei nº 8.069/1990 (ECA)",
            legislationIdentifier: "Lei nº 8.069, de 13 de julho de 1990",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1990-07-13",
            description: "Estatuto da Criança e do Adolescente.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/decreto-lei/Del3688.htm",
        nomeArquivo: "lei_contravencoes_penais",
        schema: {
            name: "Lei das Contravenções Penais",
            alternateName: "Decreto-Lei nº 3.688/1941",
            legislationIdentifier:
                "Decreto-Lei nº 3.688, de 3 de outubro de 1941",
            legislationType: "Decreto-Lei",
            datePublished: "1941-10-03",
            description: "Define as contravenções penais no Brasil.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/lei/l11340.htm",
        nomeArquivo: "lei_maria_da_penha",
        schema: {
            name: "Lei Maria da Penha",
            alternateName: "Lei nº 11.340/2006",
            legislationIdentifier: "Lei nº 11.340, de 7 de agosto de 2006",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2006-08-07",
            description:
                "Cria mecanismos para coibir a violência doméstica e familiar contra a mulher.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/lei/l12850.htm",
        nomeArquivo: "lei_crime_organizado",
        schema: {
            name: "Lei do Crime Organizado",
            alternateName: "Lei nº 12.850/2013",
            legislationIdentifier: "Lei nº 12.850, de 2 de agosto de 2013",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2013-08-02",
            description:
                "Define organização criminosa e dispõe sobre investigação criminal e meios de obtenção de prova.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/l8072.htm",
        nomeArquivo: "lei_crimes_hediondos",
        schema: {
            name: "Lei de Crimes Hediondos",
            alternateName: "Lei nº 8.072/1990",
            legislationIdentifier: "Lei nº 8.072, de 25 de julho de 1990",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1990-07-25",
            description:
                "Dispõe sobre os crimes hediondos (art. 5°, XLIII, CF).",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/_Ato2019-2022/2022/Lei/L14344.htm",
        nomeArquivo: "lei_henry_borel",
        schema: {
            name: "Lei Henry Borel",
            alternateName: "Lei nº 14.344/2022",
            legislationIdentifier: "Lei nº 14.344, de 24 de maio de 2022",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2022-05-24",
            description:
                "Cria mecanismos para prevenção e enfrentamento da violência doméstica e familiar contra criança e adolescente.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/Leis/L9296.htm",
        nomeArquivo: "lei_interceptacao_telefonica",
        schema: {
            name: "Lei de Interceptação Telefônica",
            alternateName: "Lei nº 9.296/1996",
            legislationIdentifier: "Lei nº 9.296, de 24 de julho de 1996",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1996-07-24",
            description:
                "Regulamenta o inciso XII, parte final, do art. 5° da CF.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L9613compilado.htm",
        urlHistorico: "http://www.planalto.gov.br/ccivil_03/leis/L9613.htm",
        nomeArquivo: "lei_lavagem_dinheiro",
        schema: {
            name: "Lei de Lavagem de Dinheiro",
            alternateName: "Lei nº 9.613/1998",
            legislationIdentifier: "Lei nº 9.613, de 3 de março de 1998",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1998-03-03",
            description: "Dispõe sobre crimes de lavagem ou ocultação de bens.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L9605.htm",
        nomeArquivo: "lei_crimes_ambientais",
        schema: {
            name: "Lei de Crimes Ambientais",
            alternateName: "Lei nº 9.605/1998",
            legislationIdentifier: "Lei nº 9.605, de 12 de fevereiro de 1998",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1998-02-12",
            description:
                "Dispõe sobre sanções penais e administrativas por condutas lesivas ao meio ambiente.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L7210.htm",
        nomeArquivo: "lei_execucao_penal",
        schema: {
            name: "Lei de Execução Penal",
            alternateName: "Lei nº 7.210/1984",
            legislationIdentifier: "Lei nº 7.210, de 11 de julho de 1984",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1984-07-11",
            description: "Institui a Lei de Execução Penal.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12694.htm",
        nomeArquivo: "lei_julgamento_colegiado",
        schema: {
            name: "Lei do Julgamento Colegiado em 1º Grau",
            alternateName: "Lei nº 12.694/2012",
            legislationIdentifier: "Lei nº 12.694, de 24 de julho de 2012",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2012-07-24",
            description:
                "Dispõe sobre julgamento colegiado em primeiro grau para crimes de organizações criminosas.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/leis/l7492.htm",
        nomeArquivo: "lei_crimes_sistema_financeiro",
        schema: {
            name: "Lei dos Crimes contra o Sistema Financeiro Nacional",
            alternateName: "Lei nº 7.492/1986",
            legislationIdentifier: "Lei nº 7.492, de 16 de junho de 1986",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1986-06-16",
            description:
                "Define os crimes contra o sistema financeiro nacional.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/L13964.htm",
        nomeArquivo: "pacote_anticrime",
        schema: {
            name: "Pacote Anticrime",
            alternateName: "Lei nº 13.964/2019",
            legislationIdentifier: "Lei nº 13.964, de 24 de dezembro de 2019",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2019-12-24",
            description:
                "Aperfeiçoa a legislação penal e processual penal. ATENÇÃO: lei modificadora — seus artigos transcrevem nova redação de dispositivos de outros diplomas.",
            ehLeiModificadora: true,
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/L13869.htm",
        nomeArquivo: "lei_abuso_autoridade",
        schema: {
            name: "Lei de Abuso de Autoridade",
            alternateName: "Lei nº 13.869/2019",
            legislationIdentifier: "Lei nº 13.869, de 5 de setembro de 2019",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2019-09-05",
            description:
                "Dispõe sobre os crimes de abuso de autoridade cometidos por agente público.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L8137.htm",
        nomeArquivo: "lei_crimes_ordem_tributaria",
        schema: {
            name: "Lei de Crimes contra a Ordem Tributária",
            alternateName: "Lei nº 8.137/1990",
            legislationIdentifier: "Lei nº 8.137, de 27 de dezembro de 1990",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1990-12-27",
            description:
                "Define crimes contra a ordem tributária, econômica e contra relações de consumo.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/l9609.htm",
        nomeArquivo: "lei_software",
        schema: {
            name: "Lei de Software",
            alternateName: "Lei nº 9.609/1998",
            legislationIdentifier: "Lei nº 9.609, de 19 de fevereiro de 1998",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1998-02-19",
            description:
                "Dispõe sobre a proteção da propriedade intelectual de programa de computador.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/l7960.htm",
        nomeArquivo: "lei_prisao_temporaria",
        schema: {
            name: "Lei de Prisão Temporária",
            alternateName: "Lei nº 7.960/1989",
            legislationIdentifier: "Lei nº 7.960, de 21 de dezembro de 1989",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1989-12-21",
            description: "Dispõe sobre prisão temporária.",
        },
    },
    {
        url: "http://www.planalto.gov.br/ccivil_03/leis/L6766compilado.htm",
        urlHistorico: "http://www.planalto.gov.br/ccivil_03/leis/L6766.htm",
        nomeArquivo: "lei_parcelamento_solo_urbano",
        schema: {
            name: "Lei de Parcelamento do Solo Urbano",
            alternateName: "Lei nº 6.766/1979",
            legislationIdentifier: "Lei nº 6.766, de 19 de dezembro de 1979",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1979-12-19",
            description: "Dispõe sobre o Parcelamento do Solo Urbano.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del0201.htm",
        nomeArquivo: "lei_crimes_prefeitos",
        schema: {
            name: "Lei dos Crimes de Responsabilidade de Prefeitos",
            alternateName: "Decreto-Lei nº 201/1967",
            legislationIdentifier:
                "Decreto-Lei nº 201, de 27 de fevereiro de 1967",
            legislationType: "Decreto-Lei",
            datePublished: "1967-02-27",
            description:
                "Dispõe sobre a responsabilidade dos Prefeitos e Vereadores.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/leis/l8038.htm",
        nomeArquivo: "lei_normas_processuais_stj_stf",
        schema: {
            name: "Lei de Normas Processuais do STJ e STF",
            alternateName: "Lei nº 8.038/1990",
            legislationIdentifier: "Lei nº 8.038, de 28 de maio de 1990",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1990-05-28",
            description:
                "Institui normas procedimentais para processos perante STJ e STF.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp105.htm",
        nomeArquivo: "lcp_sigilo_financeiro",
        schema: {
            name: "Lei do Sigilo das Operações Financeiras",
            alternateName: "Lei Complementar nº 105/2001",
            legislationIdentifier:
                "Lei Complementar nº 105, de 10 de janeiro de 2001",
            legislationType: "Lei Complementar Federal",
            datePublished: "2001-01-10",
            description:
                "Dispõe sobre o sigilo das operações de instituições financeiras.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2009/lei/l12037.htm",
        nomeArquivo: "lei_identificacao_criminal",
        schema: {
            name: "Lei de Identificação Criminal",
            alternateName: "Lei nº 12.037/2009",
            legislationIdentifier: "Lei nº 12.037, de 1 de outubro de 2009",
            legislationType: "Lei Ordinária Federal",
            datePublished: "2009-10-01",
            description:
                "Dispõe sobre a identificação criminal do civilmente identificado.",
        },
    },
    {
        url: "https://www.planalto.gov.br/ccivil_03/leis/l9503compilado.htm",
        urlHistorico: "https://www.planalto.gov.br/ccivil_03/leis/l9503.htm",
        nomeArquivo: "codigo_transito_brasileiro",
        schema: {
            name: "Código de Trânsito Brasileiro",
            alternateName: "Lei nº 9.503/1997 (CTB)",
            legislationIdentifier: "Lei nº 9.503, de 23 de setembro de 1997",
            legislationType: "Lei Ordinária Federal",
            datePublished: "1997-09-23",
            description:
                "Institui o Código de Trânsito Brasileiro. Define infrações e crimes de trânsito.",
        },
    },
];

// ==========================================
// CAMINHOS — saída dentro de leis/
// ==========================================

export const PASTAS = {
    rag: path.join(__dirname, "rag"),
    jsonld: path.join(__dirname, "jsonld"),
    md: path.join(__dirname, "md"),
};

// ── Prefixos de identificação por lei ─────────────────────────────────────────
// Códigos/estatutos: sigla canônica. Leis ordinárias: número sem ano/pontos.

export const PREFIXOS_LEI = {
    codigo_penal: "CP",
    codigo_processo_penal: "CPP",
    codigo_penal_militar: "CPM",
    codigo_processo_penal_militar: "CPPM",
    eca: "ECA",
    codigo_transito_brasileiro: "CTB",
    lei_execucao_penal: "LEP",
    lei_drogas: "11343",
    estatuto_desarmamento: "10826",
    lei_crimes_hediondos: "8072",
    lei_crime_organizado: "12850",
    lei_maria_da_penha: "11340",
    lei_lavagem_dinheiro: "9613",
    lei_interceptacao_telefonica: "9296",
    lei_crimes_ambientais: "9605",
    lei_abuso_autoridade: "13869",
    lei_prisao_temporaria: "7960",
    lei_henry_borel: "14344",
    lei_crimes_ordem_tributaria: "8137",
    lei_crimes_sistema_financeiro: "7492",
    lei_contravencoes_penais: "LCP",
    lei_identificacao_criminal: "12037",
    lei_julgamento_colegiado: "12694",
    lei_software: "9609",
    lei_parcelamento_solo_urbano: "6766",
    lei_crimes_prefeitos: "DL201",
    lei_normas_processuais_stj_stf: "8038",
    lcp_sigilo_financeiro: "LC105",
    pacote_anticrime: "13964",
};

export function gerarId(prefixo, artKey) {
    return `${prefixo}_${artKey}`;
}

// ==========================================
// HTTP
// ==========================================

const clienteHttp = axios.create({
    responseType: "arraybuffer",
    timeout: 60000,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (compatible; JudMap-Extrator/1.0; +https://github.com/)",
    },
    validateStatus: (status) => status >= 200 && status < 400,
});

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function baixarHtmlComRetry(url, tentativas = 4) {
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            const { data } = await clienteHttp.get(url);
            return iconv.decode(Buffer.from(data), "win1252");
        } catch (erro) {
            const status = erro?.response?.status;
            const codigo = erro?.code;
            const erroRecuperavel =
                !status ||
                status >= 500 ||
                ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED"].includes(codigo);

            if (!erroRecuperavel || tentativa === tentativas) throw erro;

            const atraso = 500 * 2 ** (tentativa - 1);
            console.log(
                `    -> [RETRY ${tentativa}/${tentativas}] falha de rede (${codigo || status || "desconhecida"}), aguardando ${atraso}ms...`,
            );
            await esperar(atraso);
        }
    }
    throw new Error("Falha inesperada no mecanismo de retry.");
}

// ==========================================
// PARSING
// ==========================================

function normalizarCaracteresQuebrados(texto) {
    return texto.replace(/\u0096/g, "-").replace(/[\u0080-\u009F]/g, " ");
}

export function removerRevogados($) {
    $("script, style, noscript").remove();
    $("strike, s, del").remove();
    $("[style]").each((_, el) => {
        const style = ($(el).attr("style") || "").toLowerCase();
        if (style.includes("line-through")) $(el).remove();
    });
}

export function extrairTextoLimpo($) {
    const textoBruto = $("body").text();
    return (
        normalizarCaracteresQuebrados(textoBruto)
            .replace(/\r/g, "")
            .replace(/\u00a0/g, " ")
            // Remove tags HTML residuais que aparecem como texto literal (ex.: Lei Maria da Penha)
            .replace(/<[^>]{1,300}>/g, " ")
            // Junta parent\u00e9ticos quebrados em duas linhas pelo HTML fonte do Planalto
            // ex.: "(Inclu\u00eddo pela Lei n\u00ba 10.224, de 15 de\n2001)" \u2192 linha \u00fanica
            .replace(/\(([^)\n]{1,250})\n\s*([^)\n]{1,100})\)/g, "($1 $2)")
            .replace(/\(([^)\n]{1,250})\n\s*([^)\n]{1,100})\)/g, "($1 $2)")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}

// ── Padrões de cabeçalhos hierárquicos (LC 95/98) ────────────────────────────

const RE_NIVEIS = [
    { nivel: "parte", re: /^(PARTE\s+(?:ESPECIAL|GERAL))\s*$/i },
    { nivel: "livro", re: /^(LIVRO\s+[IVXLCDM]+(?:-[A-Z])?)\s*$/i },
    { nivel: "titulo", re: /^(T[IÍ]TULO\s+[IVXLCDM]+(?:-[A-Z])?)\s*$/i },
    { nivel: "capitulo", re: /^(CAP[IÍ]TULO\s+[IVXLCDM]+(?:-[A-Z])?)\s*$/i },
    { nivel: "secao", re: /^(Se[çc][aã]o\s+[IVXLCDM]+(?:-[A-Z])?)\s*$/i },
    { nivel: "subsecao", re: /^(Subse[çc][aã]o\s+[IVXLCDM]+(?:-[A-Z])?)\s*$/i },
];

const ORDEM_NIVEIS = [
    "parte",
    "livro",
    "titulo",
    "capitulo",
    "secao",
    "subsecao",
];

// Captura número + sufixo letra (ex.: "216-A") mas não o dash de introdução "Art. 10 - O dia..."
const RE_ART_INICIO = /^Art\.\s*(\d+(?:-[A-Za-z])?)/;
const RE_EDITORIAL_ISOLADO =
    /^\s*\((?:Inclu[ií]d[ao]|Reda[çc][aã]o\s+dada|Revogad[ao]|Suprimid[ao]|Renumerado|Acrescentado|com\s+reda[çc][aã]o|Vide|Ver|NR)\b[^)]*\)\s*$/i;

function ehCandidatoRubrica(linha) {
    const l = linha.trim();
    if (!l || l.length < 3 || l.length > 100) return false;
    if (RE_ART_INICIO.test(l)) return false;
    if (/^[IVXLCDMivxlcdm]+\s*[-–]/.test(l)) return false; // inciso romano
    if (/^[a-z]\)/.test(l)) return false; // alínea
    if (/^§/.test(l)) return false;
    if (RE_EDITORIAL_ISOLADO.test(l)) return false;
    if (/^Pena\s*[-–]/i.test(l)) return false;
    if (!/^[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÀÜÇ]/.test(l)) return false;
    if (l.endsWith(".")) return false;
    if (/^(?:O |A |É |E |No |Na |Do |Da |De |Se |Ao |Em |Os |As )/.test(l))
        return false;
    for (const { re } of RE_NIVEIS) {
        if (re.test(l)) return false;
    }
    return true;
}

function ctxVazio() {
    return {
        parte: null,
        livro: null,
        titulo: null,
        capitulo: null,
        secao: null,
        subsecao: null,
    };
}

function resetarAbaixoDe(ctx, nivel) {
    const idx = ORDEM_NIVEIS.indexOf(nivel);
    for (let i = idx + 1; i < ORDEM_NIVEIS.length; i++) {
        ctx[ORDEM_NIVEIS[i]] = null;
    }
}

/**
 * Parser hierárquico: varre o texto linha a linha mantendo contexto estrutural
 * (parte/livro/título/capítulo/seção/subseção) e captura rubrica por artigo.
 *
 * @returns {Map<string, { texto: string, rubrica: string|null, hierarquia: object }>}
 */
export function parseiarLeiHierarquicamente(textoCompleto) {
    const mapa = new Map();
    const linhas = textoCompleto.split("\n");

    const ctx = ctxVazio();
    let awaitingDenom = null;
    let pendingRubrica = null;

    let currentArtKey = null;
    let currentLines = [];
    let currentCtxSnapshot = null;
    let currentRubrica = null;

    function proximaSubstantiva(fromIdx) {
        for (let j = fromIdx + 1; j < linhas.length; j++) {
            const lj = linhas[j].trim();
            if (!lj || RE_EDITORIAL_ISOLADO.test(lj)) continue;
            return lj;
        }
        return null;
    }

    function fecharArtigo() {
        if (!currentArtKey) return;
        const textoAchatado = achatarNormaParaRag(currentLines.join("\n"));
        if (/^Art\./.test(textoAchatado)) {
            const existente = mapa.get(currentArtKey);
            if (!existente || textoAchatado.length > existente.texto.length) {
                mapa.set(currentArtKey, {
                    texto: textoAchatado,
                    rubrica: currentRubrica,
                    hierarquia: currentCtxSnapshot,
                });
            }
        }
        currentArtKey = null;
        currentLines = [];
        currentCtxSnapshot = null;
        currentRubrica = null;
    }

    for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i].trim();
        if (!l) continue;

        // 1. Cabeçalho estrutural
        let ehEstrutura = false;
        for (const { nivel, re } of RE_NIVEIS) {
            if (re.test(l)) {
                fecharArtigo();
                ctx[nivel] = { num: l, denominacao: "" };
                resetarAbaixoDe(ctx, nivel);
                awaitingDenom = nivel;
                pendingRubrica = null;
                ehEstrutura = true;
                break;
            }
        }
        if (ehEstrutura) continue;

        // 2. Anotação editorial isolada — pular (inclusive quando aguardando denominação)
        if (RE_EDITORIAL_ISOLADO.test(l)) continue;

        // 3. Denominação pendente do nível estrutural
        if (awaitingDenom) {
            ctx[awaitingDenom].denominacao = l;
            awaitingDenom = null;
            continue;
        }

        // 4. Início de novo artigo
        if (RE_ART_INICIO.test(l)) {
            fecharArtigo();
            const m = l.match(RE_ART_INICIO);
            const identificador = m[1].trim().replace(/\s+/g, "");
            currentArtKey = `art_${normalizarIdArtigo(identificador)}`;
            currentLines = [l];
            currentCtxSnapshot = JSON.parse(JSON.stringify(ctx));
            currentRubrica = pendingRubrica;
            pendingRubrica = null;
            continue;
        }

        // 5. Rubrica candidata: look-ahead — confirma só se próxima substantiva é Art.
        //    Isso permite capturar rubricas mesmo quando ainda dentro do artigo anterior.
        if (ehCandidatoRubrica(l)) {
            const proxima = proximaSubstantiva(i);
            if (proxima && RE_ART_INICIO.test(proxima)) {
                // Remove anotações editoriais inline (ex.: "(Redação dada pela Lei nº X)")
                const rubricalimpa = l
                    .replace(
                        /\s*\((?:Inclu[ií]d[ao]|Reda[çc][aã]o\s+dada|Revogad[ao]|Suprimid[ao]|Renumerado|Acrescentado|com\s+reda[çc][aã]o|Vide|Ver|NR)\b[^)]*\)/gi,
                        "",
                    )
                    .trim();
                pendingRubrica = rubricalimpa || null;
                continue; // não appenda ao artigo atual
            }
        }

        // 6. Corpo de artigo
        if (currentArtKey) {
            currentLines.push(l);
        } else {
            pendingRubrica = null;
        }
    }

    fecharArtigo();

    // Pós-processamento: artigos revogados ficam só com a marcação de revogação
    for (const [chave, entry] of mapa) {
        const m = entry.texto.match(
            /^(Art\.\s*[\d]+[A-Za-z-]*\.\s*\([^)]*Revogad[^)]*\))/i,
        );
        if (m) mapa.set(chave, { ...entry, texto: m[1], rubrica: null });
    }

    return mapa;
}

function normalizarIdArtigo(id) {
    return String(id)
        .trim()
        .toLowerCase()
        .replace(/[º°]/g, "")
        .replace(/\s+/g, "")
        .replace(/-/g, "_");
}

export function achatarNormaParaRag(texto) {
    return (
        texto
            .replace(/\r/g, " ")
            .replace(/\n+/g, " ")
            .replace(/\t+/g, " ")
            .replace(/\s{2,}/g, " ")
            .replace(/\s+([,.;:!?\)\]])/g, "$1")
            .replace(/([\(\[])(\s+)/g, "$1")
            // Remove rótulos editoriais do Planalto no final do texto
            .replace(/\.\s+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÀÜÇ][^.\d]{3,100})\s*$/, ".")
            .trim()
    );
}

// ==========================================
// GERAÇÃO DOS ARTEFATOS
// ==========================================

export function gerarRag(url, normasMap, dataExtracao, prefixo) {
    const normas = {};
    for (const [chave, entry] of normasMap.entries()) {
        if (!/^Art\./.test(entry.texto)) continue;
        normas[chave] = {
            id: gerarId(prefixo, chave),
            artigo: chave,
            rubrica: entry.rubrica ?? null,
            texto: entry.texto,
            metadados: entry.hierarquia,
        };
    }
    return { fonte: url, data_extracao: dataExtracao, normas };
}

export function gerarJsonLd(url, normasMap, dataExtracao, schemaMeta) {
    const hasPart = [];
    for (const [chave, entry] of normasMap.entries()) {
        const { texto: textoAchatado, rubrica, hierarquia } = entry;
        if (!/^Art\./.test(textoAchatado)) continue;

        const matchId = textoAchatado.match(
            /^(Art\.?\s*[\d]+(?:\s*-[A-Za-z])?(?:\s*[º°])?)/,
        );
        const artId = matchId ? matchId[1].trim() : chave;

        const parte = {
            "@type": "Legislation",
            legislationIdentifier: artId,
            name: rubrica ?? artId,
            text: textoAchatado,
        };
        if (rubrica) parte.alternateName = rubrica;

        if (hierarquia) {
            const breadcrumb = ORDEM_NIVEIS.filter((n) => hierarquia[n])
                .map((n) => {
                    const h = hierarquia[n];
                    return h.denominacao ? `${h.num}: ${h.denominacao}` : h.num;
                })
                .join(" > ");
            if (breadcrumb) {
                parte.isPartOf = { "@type": "Legislation", name: breadcrumb };
            }
        }

        if (schemaMeta.ehLeiModificadora) {
            parte.legislationNote =
                "Artigo de lei modificadora: pode conter nova redação de dispositivo de outro diploma legal.";
        }
        hasPart.push(parte);
    }

    return {
        "@context": "https://schema.org",
        "@type": "Legislation",
        name: schemaMeta.name,
        alternateName: schemaMeta.alternateName,
        legislationIdentifier: schemaMeta.legislationIdentifier,
        legislationType: schemaMeta.legislationType,
        legislationJurisdiction: {
            "@type": "AdministrativeArea",
            name: "Brasil",
        },
        inLanguage: "pt-BR",
        url,
        datePublished: schemaMeta.datePublished,
        description: schemaMeta.description,
        dateModified: dataExtracao,
        hasPart,
    };
}

// Remove anotações editoriais do Planalto (redação dada, incluído, revogado, vide)
const ANOTACOES_EDITORIAIS =
    /\s*\((Redação dada|Incluíd[ao]|Revogad[ao]|Suprimid[ao]|Renumerado|Acrescentado|com redação|Vide|Ver|NR)\b[^)]*\)/gi;

export function gerarMarkdown(url, normasMap, dataExtracao, schemaMeta) {
    const cabecalho = [
        `# ${schemaMeta.name}`,
        "",
        `**Identificador**: ${schemaMeta.legislationIdentifier}`,
        `**Tipo**: ${schemaMeta.legislationType}`,
        `**Jurisdição**: Brasil`,
        `**Fonte**: ${url}`,
        `**Data de Extração**: ${dataExtracao}`,
        "",
        "---",
        "",
    ].join("\n");

    const artigos = [];
    for (const [, entry] of normasMap.entries()) {
        const { texto: textoAchatado, rubrica } = entry;
        if (!/^Art\./.test(textoAchatado)) continue;

        const matchId = textoAchatado.match(
            /^(Art\.?\s*[\d]+(?:[º°o])?(?:\s*-[A-Za-z])?)/,
        );
        const heading = matchId
            ? matchId[1].replace(/\s+/, " ").trim()
            : "Art.";

        const corpo = textoAchatado
            .replace(
                /^Art\.?\s*[\d]+(?:[º°o])?(?:\s*-[A-Za-z])?\s*[-–]?\s*/i,
                "",
            )
            .replace(ANOTACOES_EDITORIAIS, "")
            .replace(/\s{2,}/g, " ")
            .trim();

        if (corpo) {
            const rubricaline = rubrica ? `*${rubrica}*\n\n` : "";
            artigos.push(`## ${heading}\n\n${rubricaline}${corpo}`);
        }
    }

    return cabecalho + artigos.join("\n\n") + "\n";
}

// ==========================================
// PROCESSAMENTO
// ==========================================

export async function processarLei({ url, nomeArquivo, schema: schemaMeta }) {
    console.log(`\n[+] ${schemaMeta.name}`);
    console.log(`    URL: ${url}`);

    const dataExtracao = new Date().toISOString().slice(0, 10);

    try {
        const html = await baixarHtmlComRetry(url);
        const $ = cheerio.load(html);
        removerRevogados($);

        const textoCompleto = extrairTextoLimpo($);
        const prefixo = PREFIXOS_LEI[nomeArquivo] ?? nomeArquivo;
        const normasMap = parseiarLeiHierarquicamente(textoCompleto);
        console.log(`    -> ${normasMap.size} artigos capturados.`);

        await Promise.all([
            fs.mkdir(PASTAS.rag, { recursive: true }),
            fs.mkdir(PASTAS.jsonld, { recursive: true }),
            fs.mkdir(PASTAS.md, { recursive: true }),
        ]);

        // RAG — JSON compacto para embedding
        const ragPayload = gerarRag(url, normasMap, dataExtracao, prefixo);
        const ragPath = path.join(PASTAS.rag, `${nomeArquivo}.json`);
        await fs.writeFile(ragPath, JSON.stringify(ragPayload), "utf-8");
        console.log(`    -> RAG    : ${ragPath}`);

        // JSON-LD — schema.org/Legislation
        const jsonLdPayload = gerarJsonLd(
            url,
            normasMap,
            dataExtracao,
            schemaMeta,
        );
        const jsonLdPath = path.join(PASTAS.jsonld, `${nomeArquivo}.jsonld`);
        await fs.writeFile(
            jsonLdPath,
            JSON.stringify(jsonLdPayload, null, 2),
            "utf-8",
        );
        console.log(`    -> JSON-LD: ${jsonLdPath}`);

        // Markdown — texto limpo para leitura humana / NotebookLM
        const markdownContent = gerarMarkdown(
            url,
            normasMap,
            dataExtracao,
            schemaMeta,
        );
        const mdPath = path.join(PASTAS.md, `${nomeArquivo}.md`);
        await fs.writeFile(mdPath, markdownContent, "utf-8");
        console.log(`    -> MD     : ${mdPath}`);

        return { ok: true, nomeArquivo, artigos: normasMap.size };
    } catch (erro) {
        const status = erro?.response?.status;
        const codigo = erro?.code;
        console.error(
            `[ERRO] ${schemaMeta.name}: ${erro.message}${status ? ` | HTTP ${status}` : ""}${codigo ? ` | CODE ${codigo}` : ""}`,
        );
        return { ok: false, nomeArquivo, erro: erro.message };
    }
}

// ==========================================
// CLI
// ==========================================

async function main() {
    const args = process.argv.slice(2);

    if (args.includes("--list")) {
        console.log("Leis disponíveis:");
        for (const lei of LEIS) {
            console.log(
                `  ${lei.nomeArquivo.padEnd(40)} ${lei.schema.alternateName}`,
            );
        }
        return;
    }

    // Filtra por nome(s) passados como argumento, ou processa tudo
    const selecionadas =
        args.length > 0
            ? LEIS.filter((l) => args.includes(l.nomeArquivo))
            : LEIS;

    if (args.length > 0 && selecionadas.length === 0) {
        console.error(`Nenhuma lei encontrada para: ${args.join(", ")}`);
        console.error("Use --list para ver as leis disponíveis.");
        process.exit(1);
    }

    const resultados = [];
    for (const lei of selecionadas) {
        resultados.push(await processarLei(lei));
    }

    const ok = resultados.filter((r) => r.ok);
    const err = resultados.filter((r) => !r.ok);
    console.log(`\n[✓] ${ok.length} lei(s) extraída(s) com sucesso.`);
    if (err.length > 0) {
        console.warn(
            `[!] ${err.length} com erro: ${err.map((r) => r.nomeArquivo).join(", ")}`,
        );
    }
}

// Ponto de entrada quando executado diretamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((erro) => {
        console.error("Falha na execução:", erro.message);
        process.exit(1);
    });
}
