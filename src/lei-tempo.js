/**
 * lei-tempo.js — Lei penal no tempo (art. 2° CP)
 *
 * Determina qual versão de um dispositivo legal aplica-se ao caso concreto
 * com base na data do fato, identificando:
 *   - Novatio legis in pejus (não retroage)
 *   - Novatio legis in mellius / lex mitior (retroage obrigatoriamente)
 *   - Leis bifaciais (proibida a combinação de leis)
 *   - Abolitio criminis (cessa execução)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

let _historico = null;
function historico() {
    if (!_historico) {
        const p = path.join(__dir, '..', 'leis', 'historico_legislativo.json');
        _historico = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    return _historico;
}

// ── Utilitários de data ───────────────────────────────────────────────────────

/** Converte DD/MM/AAAA → Date UTC ou null */
function parseDataBR(str) {
    if (!str || typeof str !== 'string') return null;
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
}

/** Converte AAAA-MM-DD → Date UTC ou null */
function parseDataISO(str) {
    if (!str) return null;
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
}

function formatDataBR(date) {
    if (!date) return null;
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getUTCFullYear()}`;
}

// ── Análise de impacto de pena ────────────────────────────────────────────────

/**
 * Compara duas penas. Retorna:
 *   'nova_mais_favoravel'   — nova lei diminuiu pena (lex mitior)
 *   'nova_mais_gravosa'     — nova lei aumentou pena (in pejus)
 *   'bifacial'              — alguns aspectos mudaram em direções opostas
 *   'indeterminado'         — sem dados suficientes para comparar
 */
export function compararPenas(penaAnterior, penaNova) {
    if (!penaAnterior || !penaNova) return 'indeterminado';

    const calcDias = (p) => (p.minAnos ?? 0) * 365 + (p.minMeses ?? 0) * 30;
    const calcMaxDias = (p) => (p.maxAnos ?? 0) * 365 + (p.maxMeses ?? 0) * 30;

    const minAnt = calcDias(penaAnterior);
    const maxAnt = calcMaxDias(penaAnterior);
    const minNov = calcDias(penaNova);
    const maxNov = calcMaxDias(penaNova);

    const minMelhorou = minNov < minAnt;
    const maxMelhorou = maxNov < maxAnt;
    const minPiorou   = minNov > minAnt;
    const maxPiorou   = maxNov > maxAnt;

    if ((minMelhorou || minNov === minAnt) && (maxMelhorou || maxNov === maxAnt) && (minMelhorou || maxMelhorou)) {
        return 'nova_mais_favoravel';
    }
    if ((minPiorou || minNov === minAnt) && (maxPiorou || maxNov === maxAnt) && (minPiorou || maxPiorou)) {
        return 'nova_mais_gravosa';
    }
    if ((minMelhorou && maxPiorou) || (minPiorou && maxMelhorou)) {
        return 'bifacial';
    }
    return 'indeterminado';
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Determina qual versão de um dispositivo legal se aplica ao caso concreto.
 *
 * @param {string} slug       — ex: 'codigo_penal'
 * @param {string} artKey     — ex: 'art_157'
 * @param {string} dataFato   — DD/MM/AAAA
 * @returns {LeiTempoResult}
 *
 * @typedef {Object} LeiTempoResult
 * @property {'vigente_na_data_fato'|'lex_mitior_posterior'|'bifacial_verificar'|'sem_alteracao_relevante'|'abolitio_criminis'} status
 * @property {string|null} versaoAplicavel  — descrição da versão a aplicar
 * @property {string|null} fundamentoLegal — fundamento jurídico
 * @property {Array<string>} alertas        — alertas para o operador
 * @property {Array<Object>} alteracoesAposFato — alterações legislativas após a data do fato
 * @property {Object|null}   penaHistorica  — pena na data do fato (se diferente da atual e disponível)
 */
export function determinarLeiVigente(slug, artKey, dataFato) {
    const result = {
        status: 'sem_alteracao_relevante',
        versaoAplicavel: null,
        fundamentoLegal: null,
        alertas: [],
        alteracoesAposFato: [],
        penaHistorica: null,
    };

    const dataFatoDate = parseDataBR(dataFato);
    if (!dataFatoDate) {
        result.alertas.push('[LEI NO TEMPO] Data do fato ausente — não foi possível verificar legislação vigente.');
        return result;
    }

    const hist = historico();
    const artHist = hist[slug]?.[artKey];
    if (!artHist?.alteracoes?.length) return result;

    // Filtrar alterações posteriores ao fato
    const posteriores = artHist.alteracoes.filter(a => {
        const dv = parseDataISO(a.dataVigor);
        return dv && dv > dataFatoDate;
    });

    if (posteriores.length === 0) return result;

    result.alteracoesAposFato = posteriores;

    // Analisar cada alteração posterior
    let temLexMitior = false;
    let temInPejus = false;
    let temBifacial = false;
    let temAbolitio = false;
    let penaHistorica = null;

    for (const alt of posteriores) {
        const dvStr = formatDataBR(parseDataISO(alt.dataVigor));

        if (alt.tipo === 'abolitio_criminis') {
            temAbolitio = true;
            result.alertas.push(
                `[ABOLITIO CRIMINIS] ${slug}/${artKey}: A lei ${alt.lei} (vigor ${dvStr}) descriminalizou a conduta — a execução penal e os efeitos penais devem cessar (art. 2°, caput, CP). ${alt.descricao}`
            );
        } else if (alt.lexMitiorAplicavel === true) {
            temLexMitior = true;
            result.alertas.push(
                `[LEX MITIOR] ${slug}/${artKey}: A lei ${alt.lei} (vigor ${dvStr}) é mais favorável e RETROAGE ao fato de ${dataFato}. Fundamento: art. 2°, PU, CP. ${alt.fundamentoLeiTempo ?? alt.descricao}`
            );
            // Registrar pena histórica (a anterior, que NÃO deve ser usada)
            if (alt.penaAnterior && !penaHistorica) {
                // Lex mitior: a lei nova se aplica, então penaHistorica = penaNova
                penaHistorica = { fonte: alt.lei, ...alt.penaNova };
            }
        } else if (alt.lexMitiorAplicavel === false) {
            if (alt.tipo !== 'criacao') {
                temInPejus = true;
                result.alertas.push(
                    `[LEI NO TEMPO — IN PEJUS] ${slug}/${artKey}: A lei ${alt.lei} (vigor ${dvStr}) NÃO retroage ao fato de ${dataFato} por ser mais gravosa. ${alt.fundamentoLeiTempo ?? alt.descricao}`
                );
                // Pena histórica = pena anterior (a que se aplica ao fato)
                if (alt.penaAnterior && !penaHistorica) {
                    penaHistorica = { fonte: `anterior à ${alt.lei}`, ...alt.penaAnterior };
                }
            } else {
                result.alertas.push(
                    `[LEI NO TEMPO] ${slug}/${artKey}: Dispositivo criado pela lei ${alt.lei} (vigor ${dvStr}), posterior ao fato de ${dataFato} — NÃO se aplica ao caso concreto.`
                );
            }
        } else if (alt.lexMitiorAplicavel === 'parcial' || alt.tipo === 'bifacial') {
            temBifacial = true;
            result.alertas.push(
                `[LEI BIFACIAL] ${slug}/${artKey}: A lei ${alt.lei} (vigor ${dvStr}) alterou este dispositivo de forma bifacial — alguns aspectos mais favoráveis, outros mais gravosos. O juiz deve aplicar A LEI MAIS FAVORÁVEL EM CONJUNTO. ${alt.fundamentoLeiTempo ?? alt.descricao}`
            );
            if (alt.penaAnterior) {
                penaHistorica = { fonte: `anterior à ${alt.lei} (bifacial — verificar)`, ...alt.penaAnterior };
            }
        }
    }

    // Determinar status geral
    if (temAbolitio) {
        result.status = 'abolitio_criminis';
        result.versaoAplicavel = 'Conduta descriminalizada — verificar extinção de punibilidade.';
        result.fundamentoLegal = 'art. 2°, caput, CP';
    } else if (temLexMitior && !temInPejus && !temBifacial) {
        result.status = 'lex_mitior_posterior';
        result.versaoAplicavel = 'Aplica-se a lei posterior mais favorável (lex mitior).';
        result.fundamentoLegal = 'art. 2°, parágrafo único, CP';
    } else if (temBifacial) {
        result.status = 'bifacial_verificar';
        result.versaoAplicavel = 'Análise individualizada necessária — lei bifacial. Aplicar integralmente a lei mais favorável ao caso.';
        result.fundamentoLegal = 'art. 2°, CP';
    } else if (temInPejus) {
        result.status = 'vigente_na_data_fato';
        result.versaoAplicavel = `Aplica-se a lei vigente na data do fato (${dataFato}), por ser mais favorável ao acusado.`;
        result.fundamentoLegal = 'art. 2°, parágrafo único, CP (a contrario sensu)';
    }

    if (penaHistorica) result.penaHistorica = penaHistorica;

    return result;
}

/**
 * Verifica todos os crimes de um JSON extraído e gera alertas de lei no tempo.
 * Usa a dataFato do grau1 para todos os crimes (é a mais correta).
 *
 * @param {Object} json — JSON completo da sentença
 * @param {Function} parsearDispositivo — função de lei-lookup.js
 * @returns {Array<string>} alertas de direito intertemporal
 */
export function verificarLeiTempoJSON(json, parsearDispositivo) {
    const alertas = [];
    const dataFato = json.grau1?.dataFato;

    for (const reu of json.grau1?.reus ?? []) {
        for (const crime of [...(reu.crimesImputados ?? []), ...(reu.crimesCondenado ?? [])]) {
            const disp = crime.dispositivoLegal;
            if (!disp) continue;

            const parsed = parsearDispositivo(disp);
            if (!parsed) continue;

            const { slug, artKey } = parsed;
            const result = determinarLeiVigente(slug, artKey, dataFato);

            if (result.status !== 'sem_alteracao_relevante') {
                for (const a of result.alertas) {
                    const prefixed = `[${reu.nome ?? 'réu'}] ${a}`;
                    if (!alertas.includes(prefixed)) alertas.push(prefixed);
                }
            }
        }
    }

    return alertas;
}
