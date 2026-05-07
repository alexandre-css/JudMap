/**
 * eproc/cleaner.js
 *
 * Limpeza determinística de minutas HTML do eProc (TJSC).
 * Transforma o HTML semântico do editor eProc em:
 *   - JSON estruturado conforme acordao_schema.json
 *   - Markdown limpo para consulta facilitada
 *
 * Uso programático:
 *   import { limparMinuta } from './eproc/cleaner.js';
 *   const { json, md } = limparMinuta(htmlString);
 *
 * Uso via CLI:
 *   node eproc/cleaner.js <arquivo.html> [--out <saida.json>] [--md <saida.md>]
 */

import { load } from "cheerio";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Utilitários de texto
// ---------------------------------------------------------------------------

/**
 * Converte HTML de um parágrafo eProc em texto limpo.
 * - Resolve &nbsp; → espaço
 * - Substitui links de evento pelo texto visível "[evento N, DOCM]"
 * - Remove todas as tags preservando conteúdo textual
 * - Normaliza espaços múltiplos e trim
 */
function htmlParaTexto($, elemento) {
    const clone = $(elemento).clone();

    // Substituir <br> por marcador temporário
    clone.find("br").replaceWith("\n");

    // Links de evento do processo → texto visível apenas
    clone.find('a[data-class="widgetlinkdocumento"]').each(function () {
        const texto = $(this).text().trim();
        $(this).replaceWith(texto);
    });

    // Extrair texto, resolver entidades HTML
    let texto = clone.text();

    // Normalizar espaços e &nbsp; (cheerio já resolve entidades, mas residuais podem existir)
    texto = texto
        .replace(/\u00a0/g, " ") // non-breaking space
        .replace(/\u200b/g, "") // zero-width space
        .replace(/ {2,}/g, " ") // espaços múltiplos
        .replace(/\n{3,}/g, "\n\n") // linhas em branco excessivas
        .trim();

    return texto;
}

/**
 * Extrai o HTML interno de um elemento preservando os atributos semânticos
 * (class, data-*) mas limpando atributos puramente visuais (style inline verboso).
 * Mantém data-codtipoconteudo, data-crc32b, data-class (links de evento).
 */
function htmlSemantico($, elemento) {
    const clone = $(elemento).clone();

    // Remover atributos estritamente visuais (manter semânticos)
    clone.find("*").each(function () {
        const el = $(this);
        const tagName = this.tagName?.toLowerCase();

        // Preservar atributos em elementos-âncora de evento
        if (
            tagName === "a" &&
            el.attr("data-class") === "widgetlinkdocumento"
        ) {
            // Remover só href (que requer sessão eProc) mas manter data-*
            el.removeAttr("href");
            return;
        }

        // Em spans de anonimização, preservar data-crc32b e class
        if (el.hasClass("anonimizar")) return;

        // Em parágrafos, preservar class e data-codtipoconteudo
        if (["p", "section"].includes(tagName)) {
            el.removeAttr("id");
            return;
        }

        // Em tabelas de citação, preservar estrutura mas remover style inline
        if (tagName === "table") {
            el.removeAttr("style");
            return;
        }

        // Demais elementos: remover style e id
        el.removeAttr("style").removeAttr("id");
    });

    return $.html(clone);
}

// ---------------------------------------------------------------------------
// Detecção semântica
// ---------------------------------------------------------------------------

const REGEX_DISPOSITIVO =
    /\b(por tais razões|ante o exposto|voto por|voto no sentido|pelo exposto)\b/i;

const REGEX_TRANSCRICAO_TIPO = {
    sentenca1g:
        /sent[eê]n[cç]a|juiz.{0,30}(condenou|absolveu|decidiu)|decis[ãa]o singular/i,
    denuncia: /denúncia|denunciou|ministério público ofereceu/i,
    razoes_recursais:
        /razões recursais|razões de recurso|apelante alega|recorrente sustenta/i,
    contrarrazoes: /contrarrazões|contrarrazoou/i,
    parecer_pgj: /procuradoria.{0,20}geral|PGJ|parecer ministerial/i,
};

/**
 * Infere o tipo de transcrição a partir do texto.
 */
function inferirTipoTranscricao(texto) {
    for (const [tipo, regex] of Object.entries(REGEX_TRANSCRICAO_TIPO)) {
        if (regex.test(texto)) return tipo;
    }
    return "outro";
}

const REGEX_ORIGEM_CITACAO = {
    stj: /\bSTJ\b|Superior Tribunal de Justiça|REsp|AREsp|HC\s+\d/,
    stf: /\bSTF\b|Supremo Tribunal Federal|Min\.\s+[A-Z]/,
    tjsc: /\bTJSC\b|Tribunal de Justiça de Santa Catarina|Des\.\s+[A-Z]/,
    tj_outro: /\bTJ[A-Z]{2}\b/,
    doutrina: /[A-Z][a-z]+,\s+[A-Z]|apud|op\.\s*cit\.|p\.\s*\d{2,}/,
    depoimento: /declarou|afirmou|disse que|em juízo/i,
};

/**
 * Infere a origem de uma citação a partir do texto.
 */
function inferirOrigemCitacao(texto) {
    for (const [origem, regex] of Object.entries(REGEX_ORIGEM_CITACAO)) {
        if (regex.test(texto)) return origem;
    }
    return "outro";
}

/**
 * Mapeia data-codtipoconteudo numérico para string semântica.
 */
function mapearCodTipo(val) {
    if (val === "4" || val === 4) return "original";
    if (val === "1" || val === 1) return "template";
    return val ? String(val) : "original"; // fallback seguro
}

// ---------------------------------------------------------------------------
// Extratores de seção
// ---------------------------------------------------------------------------

/**
 * Extrai metadados do <footer> do eProc.
 */
function extrairMetadados($) {
    const footer = $("footer").first();
    if (!footer.length) return {};

    const criador =
        footer.attr("data-usuario_criador_documento_rodape") || null;
    const editor = footer.attr("data-usuario_editor_documento_rodape") || null;

    return {
        usuarioCriador: criador,
        usuarioEditor: editor,
        assessorRedator:
            criador && editor && criador !== editor ? editor : null,
        idEventoEproc:
            footer.attr("data-codigo_documento_rodape") ||
            footer.attr("id") ||
            null,
        crcVerificador: footer.attr("data-crc_documento_rodape") || null,
        versaoDocumento: footer.attr("data-versao_documento_rodape") || null,
        numProcessoRodape: footer.attr("data-numero_processo_rodape") || null,
    };
}

/**
 * Extrai identificação e partes das seções correspondentes.
 */
function extrairIdentificacaoEPartes($) {
    const identificacao = {
        classeProcessual: null,
        codigoClasse: null,
        tribunal: "TJSC",
        orgaoJulgador: null,
        idDocumento: null,
        versaoDocumento: null,
    };
    const partes = [];
    let relator = { nome: null, codMagistrado: null };
    let dataAssinatura = null;

    // Identificação do processo (pode haver <p> vazio antes do que tem os spans)
    $("p.identificacao_processo span").each(function () {
        const el = $(this);
        if (
            el.attr("data-classe_processo") &&
            !identificacao.classeProcessual
        ) {
            identificacao.classeProcessual = el.text().trim();
            identificacao.codigoClasse = el.attr("data-classe_processo");
        }
    });

    // Órgão julgador — buscar apenas na seção dedicada do eProc
    const secOrgao = $('section[data-nome="orgao_julgador"]');
    if (secOrgao.length) {
        identificacao.orgaoJulgador =
            secOrgao.text().trim().replace(/\s+/g, " ") || null;
    }

    // Relator
    $("p.relator")
        .first()
        .each(function () {
            const el = $(this);
            relator.codMagistrado = el.attr("data-cod_magistrado") || null;
            relator.nome =
                el.find("span.nome_relator").text().trim() ||
                el
                    .text()
                    .replace(/relator[:]*\s*/i, "")
                    .trim();
        });

    // Partes — data-parte_polo fica no div pai (parte_autor/parte_re), não no <p>
    $("p.parte").each(function () {
        const el = $(this);
        const divPai = el.closest("[data-parte_polo]");
        const principal = el.attr("data-sin_parte_principal");
        partes.push({
            polo: divPai.attr("data-parte_polo") || null,
            tipo: el.find("span.tipo_parte").text().trim() || null,
            nome: el.find("span.nome_parte").text().trim() || null,
            ehEntidade: divPai.attr("data-sin_parte_entidade") === "true",
            principal: principal === "S" || principal === "true",
        });
    });

    // Assinatura
    $("p.tarja_assinatura")
        .first()
        .each(function () {
            const texto = $(this).text();
            // Padrão: "Data e Hora: DD/MM/AAAA, às HH:MM:SS"
            const match = texto.match(
                /(\d{2})\/(\d{2})\/(\d{4}),?\s+[àa]s?\s+(\d{2}):(\d{2}):(\d{2})/,
            );
            if (match) {
                const [, d, m, a, h, mi, s] = match;
                dataAssinatura = `${a}-${m}-${d}T${h}:${mi}:${s}`;
            }
        });

    return { identificacao, partes, relator, dataAssinatura };
}

/**
 * Processa a seção <section data-nome="relatorio">.
 * Separa parágrafos do relator de transcrições (tabelas cinza).
 */
function processarRelatorio($, secao) {
    const paragrafosRelator = [];
    const transcricoes = [];
    let ordem = 0;

    secao.children().each(function () {
        const el = $(this);
        const tag = this.tagName?.toLowerCase();

        if (tag === "p") {
            const cls = (el.attr("class") || "").trim();

            if (cls === "paragrafoPadrao" || cls === "paragrafoComRecuo") {
                const html = htmlSemantico($, this);
                const texto = htmlParaTexto($, this);
                if (!texto) return; // parágrafo vazio

                paragrafosRelator.push({
                    ordem,
                    html,
                    texto,
                    codTipoConteudo: mapearCodTipo(
                        el.attr("data-codtipoconteudo"),
                    ),
                    ehRecuo: cls === "paragrafoComRecuo",
                });
                ordem++;
            }
            // Títulos (p.titulo) são ignorados — apenas marcadores visuais
        } else if (tag === "table") {
            // Tabelas cinza = transcrições
            const textoTabela = htmlParaTexto($, this);
            if (!textoTabela) return;

            transcricoes.push({
                tipo: inferirTipoTranscricao(textoTabela),
                html: htmlSemantico($, this),
                texto: textoTabela,
            });
        }
    });

    return { paragrafosRelator, transcricoes };
}

// ---------------------------------------------------------------------------
// Segmentação do voto por seções
// ---------------------------------------------------------------------------

/** Título numerado: "1. ADMISSIBILIDADE", "2.1. MÉRITO", "1ª FASE: PENA-BASE" */
const REGEX_TITULO_NUMERADO = /^(\d+(?:\.\d+)*)[ªa°]?\s*(?:FASE)?\s*[:.\s]/;

/** Apenas número (parcial): "2.1." — fusão com o próximo parágrafo */
const REGEX_NUMERO_PARCIAL = /^(\d+(?:\.\d+)*)\.?\s*$/;

/** Subcabeçalhos de dosimetria sem numeração própria */
const REGEX_SUBTITULO_NAONUM =
    /^(REGIME\s+INICIAL|DETRA[ÇC][ÃA]O|SUBSTITUI[ÇC][ÃA]O\s+DA\s+PENA|HONOR[ÁA]RIOS|INDENIZA[ÇC][ÃA]O\s+M[ÍI]NIMA|CONCURSO\s+DE\s+CRIMES)\b/i;

/**
 * Detecta se um parágrafo é cabeçalho de seção e extrai metadados.
 * Retorna null se for texto comum.
 */
function detectarTituloSecao(texto) {
    if (!texto) return null;
    const t = texto.trim();

    // Parcial: apenas número (ex.: "2.1.") — será fundido ao próximo parágrafo
    if (REGEX_NUMERO_PARCIAL.test(t) && t.length < 20) {
        const m = t.match(/^(\d+(?:\.\d+)*)/);
        return { numeracao: m[1], titulo: null, parcial: true };
    }

    // Numerado: "1. ADMISSIBILIDADE", "3.1. DO CRIME DE X", "1ª FASE: PENA-BASE"
    if (REGEX_TITULO_NUMERADO.test(t) && t.length < 200) {
        const m = t.match(/^(\d+(?:\.\d+)*)/);
        return { numeracao: m[1], titulo: t, parcial: false };
    }

    // Subcabeçalhos de dosimetria sem número (REGIME INICIAL, DETRAÇÃO etc.)
    if (REGEX_SUBTITULO_NAONUM.test(t) && t.length < 150) {
        return { numeracao: null, titulo: t, parcial: false };
    }

    return null;
}

/** Mapeamento de padrão regex → papel na dosimetria */
const PAPEL_DOSIMETRIA_MAP = [
    [/1[ªa°]\s*FASE|PENA[.\s-]BASE/i, "fase1"],
    [/2[ªa°]\s*FASE|INTERMEDI[ÁA]RIA/i, "fase2"],
    [/3[ªa°]\s*FASE|DEFINITIV/i, "fase3"],
    [/REGIME\s+INICIAL/i, "regime"],
    [/DETRA[ÇC][ÃA]O/i, "detracao"],
    [/SUBSTITUI[ÇC][ÃA]O/i, "substituicao"],
    [/HONOR[ÁA]RIOS/i, "honorarios"],
    [/INDENIZA[ÇC][ÃA]O\s+M[ÍI]NIMA/i, "indenizacaoMinima"],
    [/CONCURSO\s+DE\s+CRIMES/i, "concurso"],
    [/\bDO\s+CRIME\s+DE\b|\bDO\s+DELITO\s+DE\b/i, "crime"],
];

function detectarPapelDosimetria(titulo) {
    if (!titulo) return null;
    for (const [rx, papel] of PAPEL_DOSIMETRIA_MAP) {
        if (rx.test(titulo)) return papel;
    }
    return null;
}

/**
 * A partir do array de seções já construído, monta o objeto dosimetria:
 * crimes[] com fase1/fase2/fase3/regime/detração/substituição, mais
 * concurso, honorarios e indenizacaoMinima no nível raiz.
 */
function construirDosimetria(secoes) {
    const idxEntrada = secoes.findIndex((s) => s.ehDosimetria);
    if (idxEntrada === -1) return null;

    const nivelEntrada = secoes[idxEntrada].nivel;
    const textos = (sec) =>
        sec.itens.filter((i) => i.tipo === "paragrafo").map((i) => i.texto);

    const dosiSecs = [];
    for (let i = idxEntrada + 1; i < secoes.length; i++) {
        const s = secoes[i];
        // Interromper ao encontrar nova seção de nível igual/superior sem papel dosimetria
        if (
            s.nivel <= nivelEntrada &&
            !s.ehDosimetria &&
            !s.papelDosimetria &&
            s.titulo &&
            !/DISPOSITIVO/i.test(s.titulo)
        )
            break;
        if (s.papelDosimetria || s.ehCrime) dosiSecs.push(s);
    }

    if (!dosiSecs.length) return null;

    const crimes = [];
    let crimeAtual = null;
    let concurso = null;
    let honorarios = null;
    let indenizacaoMinima = null;

    for (const sec of dosiSecs) {
        if (sec.ehCrime) {
            crimeAtual = {
                titulo: sec.titulo,
                fase1: null,
                fase2: null,
                fase3: null,
                regime: null,
                detracao: null,
                substituicao: null,
            };
            crimes.push(crimeAtual);
            continue;
        }

        const papel = sec.papelDosimetria;

        if (papel === "fase1" || papel === "fase2" || papel === "fase3") {
            // Dosimetria de crime único: criar crimeAtual a partir do título da seção de entrada
            if (!crimeAtual) {
                crimeAtual = {
                    titulo: secoes[idxEntrada].titulo || null,
                    fase1: null,
                    fase2: null,
                    fase3: null,
                    regime: null,
                    detracao: null,
                    substituicao: null,
                };
                crimes.push(crimeAtual);
            }
            crimeAtual[papel] = { paragrafos: textos(sec) };
        } else if (
            papel === "regime" ||
            papel === "detracao" ||
            papel === "substituicao"
        ) {
            if (crimeAtual) crimeAtual[papel] = { paragrafos: textos(sec) };
        } else if (papel === "concurso") {
            concurso = { paragrafos: textos(sec) };
        } else if (papel === "honorarios") {
            honorarios = { paragrafos: textos(sec) };
        } else if (papel === "indenizacaoMinima") {
            indenizacaoMinima = { paragrafos: textos(sec) };
        }
    }

    return {
        crimes: crimes.length ? crimes : null,
        concurso,
        honorarios,
        indenizacaoMinima,
    };
}

/**
 * Processa a seção <section data-nome="voto">.
 * Segmenta por seções numeradas, extrai dosimetria estruturada.
 */
function processarVoto($, secao) {
    // 1. Classificar todos os filhos diretos
    const elementos = [];
    let ordemCitacao = 0;

    secao.children().each(function () {
        const el = $(this);
        const tag = this.tagName?.toLowerCase();

        if (tag === "p") {
            const cls = (el.attr("class") || "").trim();
            const isParagrafo = /paragrafoPadrao|paragrafoSemRecuo/.test(cls);
            const isCitacao = /^citacao/.test(cls);

            if (isParagrafo) {
                const texto = htmlParaTexto($, this);
                if (!texto) return;
                const html = htmlSemantico($, this);
                const codTipoConteudo = mapearCodTipo(
                    el.attr("data-codtipoconteudo"),
                );
                const ehRecuo = /ComRecuo/.test(cls);
                const ehDispositivo = REGEX_DISPOSITIVO.test(texto);
                const titInfo = detectarTituloSecao(texto);

                if (titInfo) {
                    elementos.push({ kind: "header", titInfo, texto });
                } else {
                    elementos.push({
                        kind: "paragrafo",
                        html,
                        texto,
                        codTipoConteudo,
                        ehRecuo,
                        ehDispositivo,
                    });
                }
            } else if (isCitacao) {
                const texto = htmlParaTexto($, this);
                if (!texto) return;
                elementos.push({
                    kind: "citacao",
                    ordem: ordemCitacao++,
                    origemInferida: inferirOrigemCitacao(texto),
                    aninhada: cls === "citacao2",
                    html: htmlSemantico($, this),
                    texto,
                });
            }
        } else if (tag === "table") {
            const texto = htmlParaTexto($, this);
            if (!texto) return;
            elementos.push({
                kind: "citacao",
                ordem: ordemCitacao++,
                origemInferida: inferirOrigemCitacao(texto),
                aninhada: false,
                html: htmlSemantico($, this),
                texto,
            });
        }
    });

    // 2. Fundir cabeçalhos parciais (número isolado) com o elemento seguinte
    for (let i = 0; i < elementos.length - 1; i++) {
        const el = elementos[i];
        if (el.kind === "header" && el.titInfo.parcial) {
            const next = elementos[i + 1];
            const nextTxt = next.texto?.trim() || "";
            el.titInfo.titulo = el.texto.trim() + " " + nextTxt;
            el.titInfo.parcial = false;
            elementos.splice(i + 1, 1); // absorver elemento seguinte
        }
    }

    // 3. Construir secoes[]
    const secoes = [];
    let secaoAtual = null;
    let dispositivo = null;
    const citacoesAll = [];

    const getNivel = (numeracao) => {
        if (!numeracao) return 99; // sem número → subcabeçalho sem hierarquia definida
        return (numeracao.match(/\./g) || []).length + 1;
    };

    for (const el of elementos) {
        if (el.kind === "header") {
            const { numeracao, titulo } = el.titInfo;
            const nivel = getNivel(numeracao);
            const papelDosimetria = detectarPapelDosimetria(titulo);
            const ehDosimetria =
                /aplica[çc][ãa]o\s+da\s+pena|dosimetria|fixação\s+da\s+pena/i.test(
                    titulo,
                );
            const ehCrime = papelDosimetria === "crime";

            secaoAtual = {
                titulo,
                numeracao: numeracao || null,
                nivel,
                ehDosimetria,
                ehCrime,
                papelDosimetria: ehCrime ? null : papelDosimetria,
                itens: [],
            };
            secoes.push(secaoAtual);
        } else {
            if (!secaoAtual) {
                // Conteúdo antes do primeiro cabeçalho
                secaoAtual = {
                    titulo: null,
                    numeracao: null,
                    nivel: 0,
                    ehDosimetria: false,
                    ehCrime: false,
                    papelDosimetria: null,
                    itens: [],
                };
                secoes.push(secaoAtual);
            }
            const { kind, ...item } = el;
            if (kind === "paragrafo") {
                if (item.ehDispositivo) {
                    dispositivo = { html: item.html, texto: item.texto };
                }
                secaoAtual.itens.push({ tipo: "paragrafo", ...item });
            } else {
                secaoAtual.itens.push({ tipo: "citacao", ...item });
                citacoesAll.push({ ...item }); // compat: lista plana de citações
            }
        }
    }

    const dosimetria = construirDosimetria(secoes);

    return { secoes, dosimetria, citacoes: citacoesAll, dispositivo };
}

// ---------------------------------------------------------------------------
// Gerador de Markdown
// ---------------------------------------------------------------------------

/**
 * Gera Markdown limpo a partir do JSON estruturado de um acórdão.
 */
function gerarMarkdown(json) {
    const linhas = [];

    // Cabeçalho
    const classe = json.identificacao.classeProcessual || "Acórdão";
    linhas.push(`# ${classe}`);
    linhas.push("");
    linhas.push(`**Processo:** ${json.numProcesso || "—"}`);
    linhas.push(`**Tribunal:** ${json.identificacao.tribunal || "TJSC"}`);
    if (json.identificacao.orgaoJulgador) {
        linhas.push(`**Órgão Julgador:** ${json.identificacao.orgaoJulgador}`);
    }
    linhas.push(`**Relator:** ${json.relator.nome || "—"}`);
    if (json.assessorRedator) {
        linhas.push(`**Assessor/Editor:** ${json.assessorRedator}`);
    }
    if (json.dataAssinatura) {
        const d = new Date(json.dataAssinatura);
        linhas.push(`**Assinado em:** ${d.toLocaleDateString("pt-BR")}`);
    }
    linhas.push("");

    // Partes
    if (json.partes?.length) {
        linhas.push("## Partes");
        linhas.push("");
        for (const p of json.partes) {
            if (!p.principal) continue; // omitir "OS MESMOS"
            linhas.push(
                `- **${p.tipo || p.polo?.toUpperCase() || "—"}:** ${p.nome || "[não identificado]"}`,
            );
        }
        linhas.push("");
    }

    // Relatório
    linhas.push("## RELATÓRIO");
    linhas.push("");
    for (const p of json.relatorio.paragrafosRelator) {
        if (p.codTipoConteudo === "template") {
            linhas.push(`> [TEXTO PADRÃO] ${p.texto}`);
        } else if (p.ehRecuo) {
            linhas.push(`  - ${p.texto}`);
        } else {
            linhas.push(p.texto);
        }
        linhas.push("");
    }
    for (const t of json.relatorio.transcricoes) {
        const label =
            {
                sentenca1g: "Sentença de 1º Grau",
                denuncia: "Denúncia",
                razoes_recursais: "Razões Recursais",
                contrarrazoes: "Contrarrazões",
                parecer_pgj: "Parecer PGJ",
                outro: "Transcrição",
            }[t.tipo] || "Transcrição";
        linhas.push(`> **[${label}]**`);
        // Quebrar em linhas de blockquote
        for (const linha of t.texto.split("\n")) {
            linhas.push(`> ${linha}`);
        }
        linhas.push("");
    }

    // Voto — iterar por seções estruturadas
    linhas.push("## VOTO");
    linhas.push("");
    for (const sec of json.voto.secoes ?? []) {
        if (sec.titulo) {
            // Fases de dosimetria (1ª/2ª/3ª FASE) têm numeracao "1","2","3" → nivel=1,
            // mas devem aparecer pelo menos como #### (nivel efetivo ≥ 3)
            const nivelEfetivo =
                sec.papelDosimetria &&
                /^fase\d|regime|detracao|substituicao|honorarios|indenizacao/.test(
                    sec.papelDosimetria,
                )
                    ? Math.max(sec.nivel, 3)
                    : sec.nivel === 99
                      ? 3
                      : sec.nivel;
            const hLevel = "#".repeat(Math.min(2 + nivelEfetivo, 5));
            linhas.push(`${hLevel} ${sec.titulo}`);
            linhas.push("");
        }
        for (const item of sec.itens) {
            if (item.tipo === "paragrafo") {
                if (item.codTipoConteudo === "template") {
                    linhas.push(`> [TEXTO PADRÃO] ${item.texto}`);
                } else if (item.ehRecuo) {
                    linhas.push(`  - ${item.texto}`);
                } else if (item.ehDispositivo) {
                    linhas.push(`**${item.texto}**`);
                } else {
                    linhas.push(item.texto);
                }
            } else {
                const prefixo = item.aninhada ? ">>" : ">";
                for (const linha of item.texto.split("\n")) {
                    linhas.push(`${prefixo} ${linha}`);
                }
            }
            linhas.push("");
        }
    }

    // Dispositivo resumido ao final (se extraído e não duplicado)
    if (json.voto.dispositivo?.texto) {
        linhas.push("---");
        linhas.push("");
        linhas.push(`**DISPOSITIVO:** ${json.voto.dispositivo.texto}`);
        linhas.push("");
    }

    return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Limpa uma minuta HTML do eProc e retorna JSON estruturado + Markdown.
 *
 * @param {string} htmlString - HTML bruto da minuta conforme extraído do eProc.
 * @returns {{ json: object, md: string }}
 */
export function limparMinuta(htmlString) {
    if (!htmlString || typeof htmlString !== "string") {
        throw new TypeError(
            "limparMinuta: htmlString deve ser uma string não vazia.",
        );
    }

    const $ = load(htmlString, { decodeEntities: true });

    // 1. Metadados do footer
    const metadadosFooter = extrairMetadados($);

    // 2. Identificação, partes, relator, data de assinatura
    const { identificacao, partes, relator, dataAssinatura } =
        extrairIdentificacaoEPartes($);

    // Complementar versaoDocumento e idDocumento a partir do footer
    identificacao.versaoDocumento = metadadosFooter.versaoDocumento || null;
    identificacao.idDocumento = metadadosFooter.idEventoEproc || null;

    // numProcesso: priorizar footer (mais confiável), depois span no HTML
    let numProcesso = metadadosFooter.numProcessoRodape || null;
    if (!numProcesso) {
        // Combinar número + UF: <span data-numero_processo>…</span><span data-origem_processo>SC</span>
        let num = null;
        let uf = null;
        $("p.identificacao_processo span").each(function () {
            const el = $(this);
            if (el.attr("data-numero_processo"))
                num = el.text().trim().replace(/\/$/, "");
            if (el.attr("data-origem_processo")) uf = el.text().trim();
        });
        if (num) numProcesso = uf ? `${num}/${uf}` : num;
    }
    // Fallback: span com número formatado (NNNNNNN-DD.AAAA.J.TT.OOOO)
    if (!numProcesso) {
        $("*").each(function () {
            const texto = $(this).text().trim();
            if (/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(texto)) {
                numProcesso = texto;
                return false; // break
            }
        });
    }

    // 3. Processar seções
    const secaoRelatorio = $('section[data-nome="relatorio"]');
    const secaoVoto = $('section[data-nome="voto"]');

    const relatorio = secaoRelatorio.length
        ? processarRelatorio($, secaoRelatorio)
        : { paragrafosRelator: [], transcricoes: [] };

    const votoData = secaoVoto.length
        ? processarVoto($, secaoVoto)
        : { paragrafosRelator: [], citacoes: [], dispositivo: null };

    // 4. Montar JSON conforme acordao_schema.json
    const json = {
        versaoSchema: 1,
        numProcesso,
        extraidoEm: new Date().toISOString(),

        identificacao,
        relator,
        assessorRedator: metadadosFooter.assessorRedator || null,
        dataAssinatura: dataAssinatura || null,
        partes,

        relatorio: {
            paragrafosRelator: relatorio.paragrafosRelator,
            transcricoes: relatorio.transcricoes,
        },

        voto: {
            secoes: votoData.secoes,
            dosimetria: votoData.dosimetria,
            citacoes: votoData.citacoes,
            dispositivo: votoData.dispositivo,
        },

        tesesRecursais: null,
        fundamentacoes: null,

        metadados: {
            usuarioCriador: metadadosFooter.usuarioCriador || null,
            usuarioEditor: metadadosFooter.usuarioEditor || null,
            idEventoEproc: metadadosFooter.idEventoEproc || null,
            crcVerificador: metadadosFooter.crcVerificador || null,
        },
    };

    const md = gerarMarkdown(json);

    return { json, md };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (
    process.argv[1] &&
    process.argv[1].replace(/\\/g, "/").endsWith("eproc/cleaner.js")
) {
    const args = process.argv.slice(2);
    const opts = { out: null, md: null };
    const positional = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--out") {
            opts.out = args[++i];
            continue;
        }
        if (args[i] === "--md") {
            opts.md = args[++i];
            continue;
        }
        positional.push(args[i]);
    }

    const arquivo = positional[0];
    if (!arquivo) {
        console.error(
            "Uso: node eproc/cleaner.js <arquivo.html> [--out saida.json] [--md saida.md]",
        );
        process.exit(1);
    }

    let html;
    try {
        html = readFileSync(resolve(arquivo), "utf-8");
    } catch (e) {
        console.error(`Erro ao ler "${arquivo}": ${e.message}`);
        process.exit(1);
    }

    const { json, md } = limparMinuta(html);

    if (opts.out) {
        writeFileSync(opts.out, JSON.stringify(json, null, 2), "utf-8");
        console.error(`[cleaner] JSON salvo em: ${opts.out}`);
    } else {
        process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    }

    if (opts.md) {
        writeFileSync(opts.md, md, "utf-8");
        console.error(`[cleaner] Markdown salvo em: ${opts.md}`);
    }
}
