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
 * @param {{ preservarFormato?: boolean }} [opts]
 *   preservarFormato: true → converte <strong>/<b> em **...** e <em>/<i> em *...*
 */
function htmlParaTexto($, elemento, { preservarFormato = false } = {}) {
    const clone = $(elemento).clone();

    // Substituir <br> por marcador temporário
    clone.find("br").replaceWith("\n");

    // Links de evento do processo → texto visível apenas
    clone.find('a[data-class="widgetlinkdocumento"]').each(function () {
        const texto = $(this).text().trim();
        $(this).replaceWith(texto);
    });

    if (preservarFormato) {
        // strong/b antes de em/i para preservar bold+italic aninhado (***texto***)
        clone.find("strong, b").each(function () {
            const inner = $(this).text();
            $(this).replaceWith(inner.trim() ? `**${inner}**` : inner);
        });
        clone.find("em, i").each(function () {
            const inner = $(this).text();
            $(this).replaceWith(inner.trim() ? `*${inner}*` : inner);
        });
    }

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
    // Dispositivo da sentença de 1º grau: "JULGO PROCEDENTE/IMPROCEDENTE/PARCIALMENTE"
    // Verificado ANTES de denuncia pois o texto do dispositivo cita a "denúncia"
    dispositivo_1g: /JULGO\s+(?:PROCEDENTE|IMPROCEDENTE|PARCIALMENTE)/i,
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

// ---------------------------------------------------------------------------
// Classificação estruturada de citações
// ---------------------------------------------------------------------------

/**
 * Detecta o tipo de texto da citação (tipoTexto) e a origem/fonte (origemInferida),
 * além de extrair uma referência estruturada quando possível.
 *
 * Retorna { tipoTexto, origemInferida, referencia }
 *
 * tipoTexto:
 *   "artigo_lei"    — texto de artigo, §, inciso ou alínea de lei
 *   "sumula"        — enunciado de súmula numerada
 *   "ementa"        — cabeçalho de ementa + teses de acórdão
 *   "trecho_julgado"— fragmento de julgado com ref. de processo entre colchetes
 *   "doutrina"      — trecho de livro ou artigo com referência autoral
 *   "protocolo"     — protocolo/resolução CNJ ou CNMP
 *   "depoimento"    — declaração de testemunha, réu ou vítima
 *   "outro"         — não classificado
 *
 * origemInferida:
 *   "stf" | "stj" | "tjsc" | "tj_outro" | "cnj" | "cnmp" |
 *   "doutrina" | "lei" | "depoimento" | "outro"
 */
function classificarCitacao(texto) {
    const t = texto ?? "";
    const tStrip = t.replace(/\*\*/g, "").replace(/\*/g, "").trim(); // sem markers MD

    // --- tipoTexto ---

    // 1. Artigo de lei: começa com Art./§/Inciso/Alínea
    const ehArtigo =
        /^Art(?:igo)?\.?\s+\d+|^§\s+\d+[°º]?|^[Ii]nciso\s+[IVXLCDM]+|^Al[íi]nea\s+[""]?[a-z]/.test(
            tStrip,
        );

    // 2. Súmula numerada
    const ehSumula = /S[úu]mula\s+(?:n[°º.]?\s*)?\d+/i.test(tStrip);

    // 3. Ementa de acórdão: cabeçalho em maiúsculas com ponto delimitador (ex: "PENAL. APELAÇÃO.")
    //    e comprimento mínimo para distinguir de rótulos curtos
    const ehEmenta =
        !ehArtigo &&
        /^[*\s]*[A-ZÁÉÍÓÚÃÕ][A-ZÁÉÍÓÚÃÕ\s,]+\.\s+[A-ZÁÉÍÓÚÃÕ]/.test(tStrip) &&
        tStrip.length > 80;

    // 4. Trecho de julgado com referência de processo ao final
    const refJulgadoMatch = tStrip.match(
        /\[([A-Z]{2,5}(?:,\s+[A-Za-záéíóúãõç ]+\s+[\d-]+(?:\.\d+)*)?(?:,\s+[^,\[\]]+)*(?:,\s*j\.\s*[\d/-]+)?)\]\s*$/,
    );
    const ehTrechoJulgado = !!refJulgadoMatch && !ehEmenta;

    // 5. Doutrina: referência autoral explícita (Sobrenome, Inicial. ou Ed./p. X)
    //    Excluir textos com estrutura de decisão judicial (JUSTIFICATIVA, relator, etc.)
    const ehDecisao =
        /JUSTIFICATIVA|\bRELATOR\b|\bFUNDAMENTAÇÃO\b|\bDISPOSITIVO\b/i.test(
            tStrip,
        );
    const ehDoutrina =
        !ehEmenta &&
        !ehTrechoJulgado &&
        !ehDecisao &&
        (/[A-ZÁÉÍÓÚÃÕ]{2,},\s+[A-Z][a-z]|\bapud\b|op\.\s*cit\.|In:\s+[A-Z]/.test(
            tStrip,
        ) ||
            /\d+\.\s*ed\.|[Ee]d\.\s+\d+|\d{4}\.\s*[Pp]\.\s*\d+|[Pp]\.\s*\d{2,}\./.test(
                tStrip,
            ));

    // 6. Protocolo CNJ / CNMP / resolução
    const ehProtocolo =
        /\bCNJ\b|Conselho Nacional de Justiça|Protocolo para Julgamento|Resolução\s+CNJ|\bCNMP\b/i.test(
            tStrip,
        );

    // 7. Depoimento (testemunho/declaração de pessoa)
    const ehDepoimento =
        /\bdeclarou\b|\bdisse que\b|\bafirmou\b|em ju[íi]zo|\bcontou que\b|\brelatou que\b/i.test(
            tStrip,
        );

    let tipoTexto = "outro";
    if (ehArtigo) tipoTexto = "artigo_lei";
    else if (ehSumula) tipoTexto = "sumula";
    else if (ehEmenta) tipoTexto = "ementa";
    else if (ehTrechoJulgado) tipoTexto = "trecho_julgado";
    else if (ehDoutrina) tipoTexto = "doutrina";
    else if (ehProtocolo) tipoTexto = "protocolo";
    else if (ehDepoimento) tipoTexto = "depoimento";

    // --- origemInferida ---

    // STF: sigla explícita ou classes do STF
    const ehSTF =
        /\bSTF\b|Supremo Tribunal Federal|\bADPF\s+\d|\bADI\s+\d|\bADC\s+\d|\bARE\s+\d|\bRE\s+\d{5}|\bMST?\s+\d|Min(?:istro|a?)?\.\s+[A-Z][a-záéíóú]/.test(
            t,
        ) ||
        /RECURSO\s+EXTRAORDINÁRIO|ARGUIÇÃO\s+DE\s+DESCUMPRIMENTO/.test(tStrip);
    // STJ: sigla explícita ou classes do STJ
    const ehSTJ =
        /\bSTJ\b|Superior Tribunal de Justiça|\bREsp\s+\d|\bAREsp\s+\d|\bHC\s+\d{3}|\bRHC\s+\d|Temas?\s+(?:Repetitivos?\s+)?\d+\s+(?:do\s+)?STJ/i.test(
            t,
        ) ||
        /AGRAVO\s+EM\s+RECURSO\s+ESPECIAL|RECURSO\s+ESPECIAL(?!\s+de)|RECURSO\s+EM\s+HABEAS\s+CORPUS/.test(
            tStrip,
        );
    // TJSC
    const ehTJSC =
        /\bTJSC\b|Tribunal de Justiça de Santa Catarina|Des(?:embargador[a]?)?\.\s+[A-Z]|ApCrim\s+\d/.test(
            t,
        );
    // Outro TJ
    const ehTJOutro = /\bTJ[A-Z]{2}\b/.test(t);
    // CNJ
    const ehCNJ = /\bCNJ\b|Conselho Nacional de Justiça/i.test(t);
    // CNMP
    const ehCNMP = /\bCNMP\b|Conselho Nacional do Ministério Público/i.test(t);
    // Lei / texto normativo
    const ehLei = tipoTexto === "artigo_lei";
    // Doutrina (fonte)
    const ehFonteDoutrina = tipoTexto === "doutrina";
    // Depoimento (fonte = pessoa)
    const ehFonteDepoimento = tipoTexto === "depoimento";

    let origemInferida = "outro";
    if (ehSTF) origemInferida = "stf";
    else if (ehSTJ) origemInferida = "stj";
    else if (ehTJSC) origemInferida = "tjsc";
    else if (ehTJOutro) origemInferida = "tj_outro";
    else if (ehCNJ) origemInferida = "cnj";
    else if (ehCNMP) origemInferida = "cnmp";
    else if (ehLei) origemInferida = "lei";
    else if (ehFonteDoutrina) origemInferida = "doutrina";
    else if (ehFonteDepoimento) origemInferida = "depoimento";

    // --- referencia ---
    let referencia = null;

    if (tipoTexto === "trecho_julgado" && refJulgadoMatch) {
        referencia = refJulgadoMatch[1].trim();
    } else if (tipoTexto === "sumula") {
        const m = tStrip.match(
            /S[úu]mula\s+(?:n[°º.]?\s*)?(\d+)(?:[-–]\s*|\s+do?\s+|\s+)(STJ|STF|STM|TST|TSE|TRF|TJSC|[A-Z]{2,5})?/i,
        );
        if (m)
            referencia = `Súmula ${m[1]}${m[2] ? " - " + m[2].toUpperCase() : ""}`;
    } else if (tipoTexto === "artigo_lei") {
        // Tentar extrair referência de lei (CP, CPP, lei nº X/YYYY)
        const mLei = tStrip.match(
            /\b(?:C[Oo]d(?:igo)? (?:Penal|Processo Penal|Transito)|Lei\s+n[°º.]?\s*[\d.]+\/?\d{2,4}|CP\b|CPP\b|CTB\b|ECA\b|LEP\b)/i,
        );
        const mArt = tStrip.match(/Art(?:igo)?\.?\s+(\d+(?:-[A-Z])?)/i);
        if (mArt) {
            referencia = `Art. ${mArt[1]}${mLei ? " — " + mLei[0].trim() : ""}`;
        }
    } else if (tipoTexto === "ementa" || tipoTexto === "outro") {
        // Tentar extrair ref de julgado entre colchetes em qualquer posição
        const anyRef = tStrip.match(
            /\[([A-Z]{2,5},\s+[A-Za-záéíóúãõç ,\d.-]+j\.\s*[\d/-]+)\]/,
        );
        if (anyRef) referencia = anyRef[1].trim();
    }

    return { tipoTexto, origemInferida, referencia };
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

    // Os dados estão em spans filhos, não como atributos do footer em si
    const criador =
        footer
            .find("span[data-usuario_criador_documento_rodape]")
            .attr("data-usuario_criador_documento_rodape") || null;
    const editor =
        footer
            .find("span[data-usuario_editor_documento_rodape]")
            .attr("data-usuario_editor_documento_rodape") || null;

    return {
        usuarioCriador: criador,
        usuarioEditor: editor,
        assessorRedator:
            criador && editor && criador !== editor ? editor : null,
        idEventoEproc:
            footer
                .find("span[data-codigo_documento_rodape]")
                .attr("data-codigo_documento_rodape") ||
            footer.attr("id") ||
            null,
        crcVerificador:
            footer
                .find("span[data-crc_documento_rodape]")
                .attr("data-crc_documento_rodape") || null,
        versaoDocumento:
            footer
                .find("span[data-versao_documento_rodape]")
                .attr("data-versao_documento_rodape") || null,
        numProcessoRodape:
            footer.find("span[data-numero_processo_rodape]").text().trim() ||
            null,
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

    // Padrões para identificar <p> que são resumos tipados (relator narrando
    // razões recursais, contrarrazões e parecer do MP — não são tabelas cinza,
    // mas têm tipo semântico definido pelo prefixo da primeira frase)
    const RX_PARA_TIPADO = [
        [/^Raz[õo]es\s+recursais?\s*[-–—]/i, "razoes_recursais"],
        [/^Raz[õo]es\s+de\s+recurso\s*[-–—]/i, "razoes_recursais"],
        [/^Contrarraz[õo]es?\s*[-–—]/i, "contrarrazoes"],
        [/^Parecer\b/i, "parecer_pgj"],
    ];

    secao.children().each(function () {
        const el = $(this);
        const tag = this.tagName?.toLowerCase();

        if (tag === "p") {
            const cls = (el.attr("class") || "").trim();

            if (cls === "paragrafoPadrao" || cls === "paragrafoComRecuo") {
                // Texto plano (sem markdown) apenas para detecção de tipo
                const textoPlano = htmlParaTexto($, this);
                if (!textoPlano) return; // parágrafo vazio

                // Verificar se é um parágrafo de tipo semântico definido
                let tipoDetectado = null;
                for (const [rx, tipo] of RX_PARA_TIPADO) {
                    if (rx.test(textoPlano)) {
                        tipoDetectado = tipo;
                        break;
                    }
                }

                if (tipoDetectado) {
                    const texto = htmlParaTexto($, this, {
                        preservarFormato: true,
                    });
                    transcricoes.push({
                        tipo: tipoDetectado,
                        html: htmlSemantico($, this),
                        texto,
                    });
                } else {
                    const html = htmlSemantico($, this);
                    const texto = htmlParaTexto($, this, {
                        preservarFormato: true,
                    });
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
            }
            // Títulos (p.titulo) são ignorados — apenas marcadores visuais
        } else if (tag === "table") {
            // Tabelas cinza = transcrições
            const textoTabela = htmlParaTexto($, this);
            if (!textoTabela) return;

            transcricoes.push({
                tipo: inferirTipoTranscricao(textoTabela),
                html: htmlSemantico($, this),
                texto: htmlParaTexto($, this, { preservarFormato: true }),
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

    // Variante "A - 1ª FASE: PENA-BASE" (dosimetria inline sem número)
    if (/^[A-Za-z]\s*[-\u2013]\s*\d[ªa°]/.test(t) && t.length < 150) {
        return { numeracao: null, titulo: t, parcial: false };
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

// ---------------------------------------------------------------------------
// papelVoto: papel semântico de cada seção no voto
// ---------------------------------------------------------------------------

/** Infere o polo de uma tese a partir do título */
function _inferirPoloTese(titulo) {
    const t = titulo ?? "";
    if (/MINIST[EÉ]RIO\s+P[ÚU]BLICO|ACUSA[ÇC][ÃA]O|\bMP\b/i.test(t))
        return "mp";
    if (/DEFES[AO]|RÉU|ARGUIDO|ACUSADO|APELANTE/i.test(t)) return "defesa";
    return "defesa"; // default: tese defensiva
}

/** Mapeamento de padrão → papelVoto */
const PAPEL_VOTO_MAP = [
    [/^(\d+\.?\s+)?ADMISSIBILIDADE\b/i, "admissibilidade"],
    [/\bDISPOSITIVO\b/i, "dispositivo"],
    [
        /CONFIRMA[ÇC][ÃA]O\s+DAS\s+RAZ[ÕO]ES|CONFIRMA.*SENTEN[ÇC][AÇ]/i,
        "confirmacao1g",
    ],
    [/AN[ÁA]LISE\s+DAS\s+TESES|TESES\s+DEFENSIVAS/i, "tese_defesa"],
    [/RECURSO\s+DA\s+DEFESA/i, "tese_defesa"],
    [/RECURSO\s+DO\s+MINIST[EÉ]RIO\s+P[ÚU]BLICO/i, "tese_mp"],
    [/\bHONOR[ÁA]RIOS\b/i, "honorarios"],
];

/**
 * Infere o papelVoto de uma seção com base no título e no papel herdado do pai.
 * papelPai é o papelVoto do último ancestral com nivel < nivel_atual.
 */
function inferirPapelVoto(titulo, papelPai) {
    if (!titulo) return papelPai ?? null;
    for (const [rx, papel] of PAPEL_VOTO_MAP) {
        if (rx.test(titulo)) return papel;
    }
    // Herdar de container de teses
    if (papelPai === "tese_defesa" || papelPai === "tese_mp") return papelPai;
    return "fundamento2g";
}

// ---------------------------------------------------------------------------
// Extração de pessoas (réus, vítimas, testemunhas, advogados)
// ---------------------------------------------------------------------------

/**
 * Padrões de qualificação do réu na denúncia:
 * "NOME, brasileiro, nascido em DD/MM/YYYY, natural de Cidade/UF, filho de Fulana,
 *  RG n. XXXXX/SC, inscrito no CPF XXX.XXX.XXX-XX, residente na Rua ..."
 */
const REGEX_QUALIF = {
    dataNascimento:
        /nascid[ao]\s+em\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
    naturalidade:
        /natural\s+de\s+([A-ZÁÉÍÓÚÃÕa-záéíóúãõç ,\-/]+?)(?:\s*[,;.])/i,
    cpf: /CPF\s+(?:n[°º.]?\s*)?(\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2})/i,
    rg: /RG\s+(?:n[°º.]?\s*)?([\d.\/\-]+(?:\s*\/\s*[A-Z]{2})?)/i,
    filiacaoMae:
        /filho\s+de\s+([A-ZÁÉÍÓÚÃÕ][^,;.]+?)(?:\s+e\s+[A-ZÁÉÍÓÚÃÕ]|\s*[,;.])/i,
    domicilio:
        /residente\s+(?:e\s+domiciliado\s+)?(?:na|no|em)\s+([^,;]+(?:,\s*\w[^,;]+){0,2})/i,
};

// Tipos processuais que identificam o réu
const TIPOS_REU =
    /\bRÉU\b|\bRÉ\b|\bACUSADO[A]?\b|\bDENUNCIADO[A]?\b|\bCONDENADO[A]?\b|\bPACIENTE\b|\bAGENTE\b/i;

// Tipos que identificam MP / acusação
const TIPOS_MP =
    /MINISTÉRIO PÚBLICO|MP|PROMOTOR|PROCURADOR|AUTOR(?:A)?\s*\(ACUSAÇÃO\)/i;

/**
 * Extrai e normaliza dados qualificativos de um réu a partir de um bloco de texto
 * (tipicamente a narrativa da denúncia).
 */
function extrairQualificativos(textoBloco) {
    const q = {};
    for (const [campo, rx] of Object.entries(REGEX_QUALIF)) {
        const m = textoBloco.match(rx);
        if (m) q[campo] = m[1].trim();
    }
    return Object.keys(q).length ? q : null;
}

/**
 * Extrai vítimas de textos do relatório.
 * Padrões: nome entre &nbsp; / spans, iniciais (H. C. K.), menção de "vítima" + nome.
 * Preserva anonimato (iniciais) quando o texto original já usa iniciais.
 */
function extrairVitimas(textos) {
    const encontradas = new Map(); // nomeOuIniciais → objeto

    const RX_VITIMA = [
        // "vítima H. C. K." ou "vítima NOME SOBRENOME"
        /v[íi]tima\s+([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){0,3}|\b[A-Z]\.\s*[A-Z]\.\s*(?:[A-Z]\.)?)/g,
        // "ofendida NOME"
        /ofendid[ao]\s+([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){0,2})/g,
    ];

    for (const texto of textos) {
        // Vulnerabilidade: menção de criança/adolescente/vulnerável
        const ehVulneravel =
            /crian[çc]a|adolescente|vuln[eé]r[aá]vel|menor de idade|nascid[ao] em \d/i.test(
                texto,
            );

        // Extrair idade na época dos fatos
        const idadeMatch = texto.match(
            /(?:com\s+(\d{1,2})\s+(?:anos?(?:\s+de\s+idade)?)\s+(?:à|na)\s+época|nascid[ao]\s+em\s+\S+.*?com\s+(\d{1,2})\s+anos?)/i,
        );
        const idadeEpocaFatos = idadeMatch
            ? parseInt(idadeMatch[1] ?? idadeMatch[2])
            : null;

        // Relação com réu
        let relacaoComReu = null;
        if (/enteada?/i.test(texto)) relacaoComReu = "enteado(a)";
        else if (/filh[ao]/i.test(texto)) relacaoComReu = "filho(a)";
        else if (/namorad[ao]/i.test(texto)) relacaoComReu = "namorado(a)";
        else if (/esposa|marido|cônjuge/i.test(texto))
            relacaoComReu = "cônjuge";
        else if (/vizinho/i.test(texto)) relacaoComReu = "vizinho(a)";
        else if (/patrão|empregad[ao]/i.test(texto))
            relacaoComReu = "relação empregatícia";

        for (const rx of RX_VITIMA) {
            for (const m of texto.matchAll(rx)) {
                const nome = m[1].trim();
                if (!nome || nome.length < 2) continue;
                // Ignorar falsos positivos (palavras genéricas)
                if (/^(?:do|da|de|em|que|no|na|os|as)$/i.test(nome)) continue;
                if (!encontradas.has(nome)) {
                    encontradas.set(nome, {
                        nomeOuIniciais: nome,
                        vulneravel:
                            ehVulneravel || /[A-Z]\.\s*[A-Z]\./.test(nome),
                        idadeEpocaFatos,
                        relacaoComReu,
                    });
                }
            }
        }
    }

    return [...encontradas.values()];
}

/**
 * Extrai testemunhas mencionadas em citações do tipo "depoimento".
 */
function extrairTestemunhas(citacoes) {
    const encontradas = new Map();

    // Padrão: "NOME em juízo" ou "testemunha NOME" ou "NOME (ev. N, vídeo N)"
    const RX_TESTEMUNHA = [
        /([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){1,3})\s+em\s+ju[íi]zo/g,
        /testemunha\s+([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){1,3})/gi,
        /([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){1,3})\s+\(ev\.\s+\d+/g,
    ];

    // Indicadores de tipo de testemunha
    const RX_POLICIAL = /policial|delegad[ao]|investigador|inspetor/i;
    const RX_PERITO = /perit[ao]|médic[ao] legista|examinador/i;

    for (const cit of citacoes) {
        if (cit.tipoTexto !== "depoimento") continue;
        const texto = (cit.texto || "").replace(/\*\*/g, "").replace(/\*/g, "");

        const ehPolicial = RX_POLICIAL.test(texto);
        const ehPerito = RX_PERITO.test(texto);
        const tipo = ehPerito
            ? "perito"
            : ehPolicial
              ? "policial/investigador"
              : "testemunha";

        for (const rx of RX_TESTEMUNHA) {
            for (const m of texto.matchAll(rx)) {
                const nome = m[1].trim();
                if (!nome || nome.length < 4) continue;
                // Filtrar nomes genéricos
                if (/^(?:Quando|Disse|Afirmou|Relatou|Contou)$/i.test(nome))
                    continue;
                if (!encontradas.has(nome)) {
                    encontradas.set(nome, { nome, tipo });
                }
            }
        }
    }

    return [...encontradas.values()];
}

/**
 * Consolida todas as informações de pessoas do acórdão.
 * Retorna { reus[], vitimas[], testemunhas[], promotor }.
 */
function extrairPessoas(partes, relatorioData, votoData) {
    // --- Réus ---
    const textosDenuncia = (relatorioData?.transcricoes ?? [])
        .filter((t) => t.tipo === "denuncia" || t.tipo === "sentenca1g")
        .map((t) => t.texto.replace(/\*\*/g, "").replace(/\*/g, ""));

    const textosBlocoRelatorio = (relatorioData?.paragrafosRelator ?? []).map(
        (p) => p.texto.replace(/\*\*/g, "").replace(/\*/g, ""),
    );

    const todoTextoRelatorio = [
        ...textosDenuncia,
        ...textosBlocoRelatorio,
    ].join(" ");

    // Em recursos criminais, a parte não-entidade (ehEntidade=false) é sempre o réu/acusado,
    // independente de ser APELANTE ou APELADO. Filtrar apenas nomes que não sejam
    // marcadores genéricos como "OS MESMOS" ou "IDEM".
    const reus = partes
        .filter(
            (p) =>
                !p.ehEntidade &&
                /APELANTE|APELADO|RECORRENTE|RECORRIDO|EMBARGANTE|EMBARGADO|PACIENTE|IMPETRANTE|CONDENADO/i.test(
                    p.tipo || "",
                ) &&
                !/^(?:OS MESMOS|IDEM)$/i.test((p.nome || "").trim()),
        )
        .map((p) => {
            // Limpar sufixo como "(RÉU)", "(ACUSADO)"
            const nomeLimpo = (p.nome || "")
                .replace(/\s*\(.*?\)\s*/g, "")
                .trim();

            // Procurar bloco do texto com o nome do réu para extrair qualificativos
            const rx = new RegExp(
                nomeLimpo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "[^.]{0,500}",
                "i",
            );
            const blocoMatch = todoTextoRelatorio.match(rx);
            const qualificativos = blocoMatch
                ? extrairQualificativos(blocoMatch[0])
                : null;

            return {
                nome: nomeLimpo,
                tipoProcessual: p.tipo || null,
                polo: p.polo || null,
                qualificativos,
            };
        });

    // --- Vítimas ---
    const vitimas = extrairVitimas([todoTextoRelatorio]);

    // --- Testemunhas ---
    const testemunhas = extrairTestemunhas(votoData?.citacoes ?? []);

    // --- Promotor / MP ---
    // Raramente nominado; capturar quando presente no texto
    let promotor = null;
    const rxPromotor =
        /[Pp]romotor[a]?\s+(?:de\s+[Jj]usti[çc]a\s+)?([A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+){1,4})/;
    const matchPromotor = todoTextoRelatorio.match(rxPromotor);
    if (matchPromotor) promotor = matchPromotor[1].trim();

    return {
        reus: reus.length ? reus : null,
        vitimas: vitimas.length ? vitimas : null,
        testemunhas: testemunhas.length ? testemunhas : null,
        promotor,
    };
}

// ---------------------------------------------------------------------------
// Extratores de teses e fundamentações
// ---------------------------------------------------------------------------

/**
 * Infere o resultado do acórdão por polo (defesa / mp) a partir do texto do dispositivo.
 * Usa padrões como "recurso da defesa... negar", "recurso do MP... provimento".
 */
function extrairResultadoPorPolo(textoLower) {
    const resultado = {};

    // Defesa — ex.: "recurso defensivo: negar-lhe provimento" / "recurso da defesa: dar provimento"
    if (
        /recurso\s+(?:da\s+defesa|defensivo)[^;.]{0,80}(?:negar|negado|improvido|n[ãa]o\s+prover)/i.test(
            textoLower,
        )
    )
        resultado.defesa = "negado_provimento";
    else if (
        /recurso\s+(?:da\s+defesa|defensivo)[^;.]{0,80}(?:dar\s+provimento|provimento|absolver)/i.test(
            textoLower,
        )
    )
        resultado.defesa = "provimento";

    // MP — ex.: "recurso do MP: negar" / "recurso do Ministério Público: provimento parcial"
    if (
        /recurso\s+do\s+(?:minist[eé]rio\s+p[úu]blico|mp\b)[^;.]{0,80}(?:negar|negado|improvido|n[ãa]o\s+prover)/i.test(
            textoLower,
        )
    )
        resultado.mp = "negado_provimento";
    else if (
        /recurso\s+do\s+(?:minist[eé]rio\s+p[úu]blico|mp\b)[^;.]{0,80}(?:dar\s+provimento|provimento)/i.test(
            textoLower,
        )
    )
        resultado.mp = "provimento";

    return Object.keys(resultado).length ? resultado : null;
}

/**
 * Extrai o resultado estruturado do acórdão a partir do texto do dispositivo do voto.
 */
function extrairResultadoAcordao(texto) {
    if (!texto) return null;
    const t = texto.replace(/\*\*/g, "").replace(/\*/g, "");
    const tl = t.toLowerCase();

    // Resultado geral
    let resultado = "outro";
    if (/rejeitar.{0,20}embargos/i.test(t)) resultado = "embargos_rejeitados";
    else if (/acolher.{0,20}embargos/i.test(t))
        resultado = "embargos_acolhidos";
    else if (/denegar|denegada/i.test(t)) resultado = "hc_denegado";
    else if (/conceder.{0,20}ordem|ordem.{0,20}concedida/i.test(t))
        resultado = "hc_concedido";
    else if (/absolver|absolvi/i.test(t)) resultado = "absolvicao";
    else if (
        /provimento\s+parcial|parcial\s+provimento|dar-lhe[ms]?\s+(?:parcial|provimento\s+parcial)/i.test(
            t,
        )
    )
        resultado = "provimento_parcial";
    else if (
        /negar-lhe[ms]?\s+provimento|negar.{0,10}provimento|improvido/i.test(t)
    )
        resultado = "negado_provimento";
    else if (/dar-lhe[ms]?\s+provimento|dar\s+provimento/i.test(t))
        resultado = "provimento_total";

    // Dosimetria modificada?
    const dosimetriaModificada =
        /redimensionar|readequar|reformar.{0,10}pena|fixar.{0,10}nova\s+pena|ajustar.{0,10}pena|nova\s+pena\s+(?:total|definitiva)|patamar\s+de\s+\d/i.test(
            t,
        );

    // Nova pena total quando modificada.
    // Suporta: "12 (doze) anos", "12 anos", "10 meses", "1 ano e 6 meses"
    let novaPenaTotal = null;
    if (dosimetriaModificada) {
        // Tentar capturar aãnos primeiro (pode ser 0 se pena só em meses)
        const mAnos = t.match(
            /(?:para|patamar\s+de|total\s+de)\s+(\d+)\s*(?:\([^)]+\)|\[[^\]]+\])?\s*anos?/i,
        );
        const mMeses = t.match(
            /(?:anos?\s+e\s+|para\s+|patamar\s+de\s+)(\d+)\s*(?:\([^)]+\)|\[[^\]]+\])?\s*mes(?:es)?/i,
        );
        const mDias = t.match(
            /mes(?:es)?\s+e\s+(\d+)\s*(?:\([^)]+\)|\[[^\]]+\])?\s*dias?/i,
        );
        if (mAnos || mMeses) {
            novaPenaTotal = {
                anos: mAnos ? parseInt(mAnos[1]) : null,
                meses: mMeses ? parseInt(mMeses[1]) : null,
                dias: mDias ? parseInt(mDias[1]) : null,
            };
        }
    }

    // Novo regime inicial quando alterado
    let novoRegimeInicial = null;
    if (dosimetriaModificada) {
        const mReg = t.match(
            /regime\s+(?:inicial(?:mente)?\s+)?(fechado|semiaberto|semi-aberto|aberto)/i,
        );
        if (mReg)
            novoRegimeInicial = mReg[1]
                .toLowerCase()
                .replace("semi-aberto", "semiaberto");
    }

    const resultadoPorPolo = extrairResultadoPorPolo(tl);

    return {
        resultado,
        dosimetriaModificada,
        novaPenaTotal,
        novoRegimeInicial,
        resultadoPorPolo,
    };
}

/**
 * Extrai dados estruturados da sentença de 1º grau a partir da transcrição
 * do dispositivo (tipo="dispositivo_1g") no relatório.
 */
function extrairDados1g(transcricoes) {
    const disp = (transcricoes ?? []).find((t) => t.tipo === "dispositivo_1g");
    if (!disp) return null;

    const texto = disp.texto.replace(/\*\*/g, "").replace(/\*/g, "");

    // Resultado: condenatório / absolutório / parcial
    let resultadoSentenca = null;
    if (/JULGO\s+PARCIALMENTE\s+PROCEDENTE/i.test(texto))
        resultadoSentenca = "parcialmente_condenatorio";
    else if (/JULGO\s+(?:TOTALMENTE\s+)?PROCEDENTE/i.test(texto))
        resultadoSentenca = "condenatorio";
    else if (/JULGO\s+IMPROCEDENTE/i.test(texto))
        resultadoSentenca = "absolutorio";

    // Pena privativa de liberdade
    // Suporta: "1 (um) ano, 6 (seis) meses" ou "1 ano e 6 meses" (com ou sem extenso)
    let pena = null;
    const mPena = texto.match(
        /(\d+)\s*(?:\([^)]+\))?\s*anos?(?:\s*[,e]\s*(\d+)\s*(?:\([^)]+\))?\s*mes(?:es)?)?(?:\s*[,e]\s*(\d+)\s*(?:\([^)]+\))?\s*dias?)?\s*de\s+(reclus[ãa]o|deten[çc][ãa]o|pris[ãa]o\s+simples)/i,
    );
    if (mPena) {
        pena = {
            anos: parseInt(mPena[1]),
            meses: mPena[2] ? parseInt(mPena[2]) : null,
            dias: mPena[3] ? parseInt(mPena[3]) : null,
            modalidade: mPena[4].toLowerCase(),
        };
    }

    // Regime inicial
    let regime = null;
    const mReg = texto.match(
        /regime\s+(?:inicial(?:mente)?\s+)?(fechado|semiaberto|semi-aberto|aberto)/i,
    );
    if (mReg)
        regime = mReg[1].toLowerCase().replace("semi-aberto", "semiaberto");

    // Artigos imputados (ex.: "artigo 217-A, caput, c/c artigo 226, inciso II")
    const artigos = [];
    for (const m of texto.matchAll(
        /(?:art(?:igo)?s?\.?\s+)(\d+(?:-[A-Z])?)/gi,
    )) {
        const a = m[1];
        if (!artigos.includes(a)) artigos.push(a);
    }

    return {
        texto: disp.texto,
        resultadoSentenca,
        pena,
        regime,
        artigos: artigos.length ? artigos : null,
    };
}

/**
 * Extrai o parecer da Procuradoria-Geral de Justiça a partir das transcrições do relatório.
 */
function extrairParecerPGJ(transcricoes) {
    const parecer = (transcricoes ?? []).find((t) => t.tipo === "parecer_pgj");
    if (!parecer) return null;
    return { texto: parecer.texto };
}

/**
 * Extrai teses recursais (pedidos das partes) a partir das seções do voto.
 * Retorna array de { polo, titulo, paragrafos[] } ou null.
 */
function extrairTesesRecursais(secoes, partes, transcricoes) {
    // Determinar quem recorreu: polo → "recursal" | "contrarrecursal"
    // Parte com ehEntidade=false e tipo APELANTE = réu recorreu
    // Parte com ehEntidade=true (MP) e tipo APELANTE = MP recorreu
    const apelantes = new Set(
        (partes ?? [])
            .filter((p) =>
                /APELANTE|RECORRENTE|EMBARGANTE|IMPETRANTE/i.test(p.tipo || ""),
            )
            .map((p) => (p.ehEntidade ? "mp" : "defesa")),
    );

    const teses = [];
    for (const sec of secoes) {
        const polo =
            sec.papelVoto === "tese_defesa"
                ? "defesa"
                : sec.papelVoto === "tese_mp"
                  ? "mp"
                  : null;
        if (!polo) continue;
        // Se o polo está entre os apelantes → recursal; caso contrário → contrarrecursal
        const tipoTese = apelantes.has(polo) ? "recursal" : "contrarrecursal";
        const paragrafos = sec.itens
            .filter((i) => i.tipo === "paragrafo")
            .map((i) => i.texto);
        const citacoes = sec.itens
            .filter((i) => i.tipo === "citacao")
            .map((i) => i.texto);
        // Container vazio (só título, sem conteúdo) = seção-pai; incluir mesmo assim
        teses.push({
            polo,
            tipoTese,
            titulo: sec.titulo,
            paragrafos,
            citacoes,
            fonte: "voto",
        });
    }

    // Fallback: sem seção explícita no voto → usar transcrições tipadas do relatório
    if (teses.length === 0 && transcricoes) {
        const razoes = (transcricoes ?? []).filter(
            (t) => t.tipo === "razoes_recursais",
        );
        const contrArr = (transcricoes ?? []).filter(
            (t) => t.tipo === "contrarrazoes",
        );

        for (const r of razoes) {
            // Inferir polo: "Razões recursais - Acusado" → defesa; "- MP / Ministério" → mp
            const polo =
                /minist[eé]rio\s+p[úu]blico|\bMP\b|acusa[çc][ãa]o/i.test(
                    r.texto,
                )
                    ? "mp"
                    : "defesa";
            const tipoTese = apelantes.has(polo)
                ? "recursal"
                : "contrarrecursal";
            teses.push({
                polo,
                tipoTese,
                titulo: null,
                paragrafos: [r.texto],
                citacoes: [],
                fonte: "relatorio",
            });
        }
        for (const c of contrArr) {
            // Contrarrazões: polo é o oposto de quem recorreu
            const polo =
                /minist[eé]rio\s+p[úu]blico|\bMP\b|acusa[çc][ãa]o/i.test(
                    c.texto,
                )
                    ? "mp"
                    : "defesa";
            const tipoTese = apelantes.has(polo)
                ? "recursal"
                : "contrarrecursal";
            teses.push({
                polo,
                tipoTese,
                titulo: null,
                paragrafos: [c.texto],
                citacoes: [],
                fonte: "relatorio",
            });
        }
    }

    return teses.length ? teses : null;
}

/**
 * Extrai fundamentos de 1º grau (sentença recorrida) e de 2º grau (relator).
 *
 * Retorna:
 *   "1g": { paragrafos[], citacoes[] } | null
 *     → texto da sentença transcrito pelo relator (relatório + voto)
 *
 *   "2g_template": [{ titulo, paragrafos[], citacoes[] }]
 *     → blocos de doutrina/protocolo padrão do relator (codTipoConteudo="template")
 *     → reutilizados em múltiplos processos; não se referem ao caso concreto
 *
 *   "2g_caso": [{ titulo, paragrafos[], citacoes[] }]
 *     → análise do relator específica para este caso concreto (codTipoConteudo="original")
 *     → não inclui seções de teses recursais nem de dosimetria
 */
function extrairFundamentacoes(secoes, relatorioTranscricoes) {
    // 1g — transcrições da sentença no relatório
    const par1g = (relatorioTranscricoes ?? [])
        .filter((t) => t.tipo === "sentenca1g")
        .map((t) => t.texto);
    const cit1g = [];

    // 1g — seções de confirmação das razões da sentença no voto
    for (const sec of secoes) {
        if (sec.papelVoto !== "confirmacao1g") continue;
        for (const item of sec.itens) {
            if (item.tipo === "citacao") cit1g.push(item.texto);
            else if (item.tipo === "paragrafo") par1g.push(item.texto);
        }
    }

    // 1g — citações marcadas como juiz_1g dentro de seções fundamento2g
    for (const sec of secoes) {
        if (sec.papelVoto !== "fundamento2g") continue;
        for (const item of sec.itens) {
            if (item.tipo === "citacao" && item.fonte === "juiz_1g") {
                cit1g.push(item.texto);
            }
        }
    }

    // 2g — separar: blocos template (cod=1) vs. análise do caso concreto (cod=empty)
    const f2gTemplate = [];
    const f2gCaso = [];

    for (const sec of secoes) {
        if (sec.papelVoto !== "fundamento2g") continue;

        // Separar itens por origem
        const itensPorTipo = { template: [], caso: [] };
        for (const item of sec.itens) {
            // Citações marcadas como 1g já foram para cit1g; não duplicar
            if (item.tipo === "citacao" && item.fonte === "juiz_1g") continue;

            const bucket =
                item.tipo === "paragrafo" && item.codTipoConteudo === "template"
                    ? "template"
                    : "caso";
            itensPorTipo[bucket].push(item);
        }

        // Seção template: majoritariamente cod=1
        const pTemplate = itensPorTipo.template
            .filter((i) => i.tipo === "paragrafo")
            .map((i) => i.texto);
        const cTemplate = itensPorTipo.template
            .filter((i) => i.tipo === "citacao")
            .map((i) => i.texto);
        if (pTemplate.length || cTemplate.length) {
            f2gTemplate.push({
                titulo: sec.titulo,
                paragrafos: pTemplate,
                citacoes: cTemplate,
            });
        }

        // Seção caso concreto: cod=empty ou citações não-1g
        const pCaso = itensPorTipo.caso
            .filter((i) => i.tipo === "paragrafo")
            .map((i) => i.texto);
        const cCaso = itensPorTipo.caso
            .filter((i) => i.tipo === "citacao")
            .map((i) => i.texto);
        if (pCaso.length || cCaso.length) {
            f2gCaso.push({
                titulo: sec.titulo,
                paragrafos: pCaso,
                citacoes: cCaso,
            });
        }
    }

    return {
        "1g":
            par1g.length || cit1g.length
                ? { paragrafos: par1g, citacoes: cit1g }
                : null,
        "2g_template": f2gTemplate.length ? f2gTemplate : null,
        "2g_caso": f2gCaso.length ? f2gCaso : null,
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
                // textoPlano: sem formatação — usado para detecção de cabeçalho e REGEX_DISPOSITIVO
                const textoPlano = htmlParaTexto($, this);
                if (!textoPlano) return;
                const titInfo = detectarTituloSecao(textoPlano);

                if (titInfo) {
                    elementos.push({
                        kind: "header",
                        titInfo,
                        texto: textoPlano,
                    });
                } else {
                    const html = htmlSemantico($, this);
                    const codTipoConteudo = mapearCodTipo(
                        el.attr("data-codtipoconteudo"),
                    );
                    const ehRecuo = /ComRecuo/.test(cls);
                    const ehDispositivo = REGEX_DISPOSITIVO.test(textoPlano);
                    const texto = htmlParaTexto($, this, {
                        preservarFormato: true,
                    });
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
                const texto = htmlParaTexto($, this, {
                    preservarFormato: true,
                });
                if (!texto) return;
                const classif = classificarCitacao(texto);
                elementos.push({
                    kind: "citacao",
                    ordem: ordemCitacao++,
                    ...classif,
                    aninhada: cls === "citacao2",
                    html: htmlSemantico($, this),
                    texto,
                });
            }
        } else if (tag === "table") {
            const texto = htmlParaTexto($, this, { preservarFormato: true });
            if (!texto) return;
            const classif = classificarCitacao(texto);
            elementos.push({
                kind: "citacao",
                ordem: ordemCitacao++,
                ...classif,
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

    // Marcação de contexto 1g: paragrafos-sentinela que introduzem citações do juiz de 1ª instância
    // ex.: "Constou da sentença condenatória:", "Conforme a sentença:", "Adota-se a fundamentação"
    const RX_INTRO_1G =
        /constou\s+da\s+senten[çc]a|conforme\s+(?:a\s+)?senten[çc]a|adota.{0,10}fundamento\s+da\s+senten[çc]a|razões\s+da\s+senten[çc]a|senten[çc]a\s+condenat[oó]ria\s*:/i;

    for (let i = 0; i < elementos.length; i++) {
        const el = elementos[i];
        if (el.kind !== "paragrafo") continue;
        if (!RX_INTRO_1G.test(el.texto || "")) continue;
        // Tag os elementos citacao imediatamente seguintes (até encontrar outro parágrafo não-vazio)
        for (let j = i + 1; j < elementos.length; j++) {
            const next = elementos[j];
            if (next.kind === "citacao") {
                next.fonte = "juiz_1g";
            } else if (next.kind === "paragrafo" && (next.texto || "").trim()) {
                break; // parágrafo real → fim do bloco 1g
            }
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

    // Stack para herança de papelVoto: [{ nivel, papelVoto }]
    const papelStack = [];

    for (const el of elementos) {
        if (el.kind === "header") {
            const { numeracao, titulo } = el.titInfo;
            const nivel = getNivel(numeracao);
            const papelDosimetria = detectarPapelDosimetria(titulo);
            const ehDosimetria =
                /aplica[çc][ãa]o\s+da\s+pena|dosimetria|fix[ao][çc][ãa]o\s+da\s+pena|redimensionamento/i.test(
                    titulo,
                );
            const ehCrime = papelDosimetria === "crime";

            // Calcular papelVoto com herança do pai via stack
            while (
                papelStack.length &&
                papelStack[papelStack.length - 1].nivel >= nivel
            ) {
                papelStack.pop();
            }
            const papelPai = papelStack.length
                ? papelStack[papelStack.length - 1].papelVoto
                : null;
            const papelVoto = ehDosimetria
                ? "dosimetria"
                : ehCrime
                  ? "dosimetria"
                  : papelDosimetria
                    ? "dosimetria" // fase1/2/3, regime, etc.
                    : inferirPapelVoto(titulo, papelPai);
            papelStack.push({ nivel, papelVoto });

            secaoAtual = {
                titulo,
                numeracao: numeracao || null,
                nivel,
                ehDosimetria,
                ehCrime,
                papelDosimetria: ehCrime ? null : papelDosimetria,
                papelVoto,
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
                dispositivo_1g: "Dispositivo da Sentença",
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

        tesesRecursais: extrairTesesRecursais(
            votoData.secoes ?? [],
            partes,
            relatorio.transcricoes,
        ),
        fundamentacoes: extrairFundamentacoes(
            votoData.secoes ?? [],
            relatorio.transcricoes,
        ),
        pessoas: extrairPessoas(partes, relatorio, votoData),
        acordao: extrairResultadoAcordao(votoData.dispositivo?.texto ?? null),
        pena1g: extrairDados1g(relatorio.transcricoes),
        parecerPGJ: extrairParecerPGJ(relatorio.transcricoes),

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
