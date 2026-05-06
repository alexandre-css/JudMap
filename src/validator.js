/**
 * Valida os campos categóricos do JSON extraído contra o enum.json.
 * Substitui valores inválidos por null e registra warnings.
 * Também dispara alertas automáticos conforme _regrasGerais.alertasAutomaticos.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parsearDispositivo } from "./lei-lookup.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
let _dosimetria = null;
function dosimetria() {
    if (!_dosimetria) {
        const p = path.join(__dir, "..", "leis", "index_dosimetria.json");
        _dosimetria = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    return _dosimetria;
}

const ORDEM_FRACOES = [
    "1/8",
    "1/6",
    "1/5",
    "1/4",
    "1/3",
    "1/2",
    "2/3",
    "triplo",
];

function fracaoIndex(f) {
    return ORDEM_FRACOES.indexOf(f);
}

function validarFracao(fracao, causa, tipo, path, warnings) {
    if (!fracao || !causa) return;
    const idx =
        tipo === "aumento"
            ? dosimetria().causasAumento?.[causa]
            : dosimetria().causasDiminuicao?.[causa];
    if (!idx) return;

    if (idx.fracaoFixa && fracao !== idx.fracaoFixa) {
        warnings.push(
            `[FRAÇÃO inválida] ${path}: causa "${causa}" exige fração fixa ${idx.fracaoFixa}, mas foi "${fracao}"`,
        );
        return;
    }
    if (idx.fracaoMin && idx.fracaoMax) {
        const iVal = fracaoIndex(fracao);
        const iMin = fracaoIndex(idx.fracaoMin);
        const iMax = fracaoIndex(idx.fracaoMax);
        if (iVal < 0 || iVal < iMin || iVal > iMax) {
            warnings.push(
                `[FRAÇÃO fora do intervalo] ${path}: causa "${causa}" permite ${idx.fracaoMin}–${idx.fracaoMax}, mas foi "${fracao}" (${idx.dispositivo})`,
            );
        }
    }
}

// Conjunto de todos os valores válidos de causasAumento e causasDiminuicao
function buildCausasSet(enumDict) {
    const sets = { aumento: new Set(), diminuicao: new Set() };
    for (const [k, v] of Object.entries(enumDict.fase3 ?? {})) {
        if (k.startsWith("_")) continue;
        if (Array.isArray(v)) {
            const target = k.startsWith("causasAumento")
                ? sets.aumento
                : sets.diminuicao;
            v.forEach((x) => x && target.add(x));
        }
    }
    return sets;
}

function isValidEnum(value, allowedValues) {
    if (value === null || value === undefined) return true;
    return allowedValues.includes(value);
}

function isValidRecorrente(value, enumDict) {
    if (value === null) return true;
    if (enumDict.recursos?.recorrente?.includes(value)) return true;
    if (typeof value === "string" && value.startsWith("reu:")) return true;
    return false;
}

function checkAndFix(obj, field, allowed, path, warnings) {
    if (!(field in obj)) return;
    const val = obj[field];
    if (val === null || val === undefined) return;
    if (!allowed.includes(val)) {
        warnings.push(
            `[ENUM inválido] ${path}.${field} = "${val}" — substituído por null`,
        );
        obj[field] = null;
    }
}

function checkArrayEnum(arr, allowed, path, warnings) {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && !allowed.includes(arr[i])) {
            warnings.push(
                `[ENUM inválido] ${path}[${i}] = "${arr[i]}" — removido`,
            );
            arr.splice(i, 1);
        }
    }
}

function validarReu(reu, path, enumDict, causas, warnings) {
    checkAndFix(reu, "tipoDefesa", enumDict.reu.tipoDefesa, path, warnings);
    checkAndFix(reu, "resultado", enumDict.reu.resultado, path, warnings);

    const sit = reu.situacaoPrisional;
    if (sit) {
        checkAndFix(
            sit,
            "estadoAtual",
            enumDict.reu.situacaoPrisional_estadoAtual,
            `${path}.situacaoPrisional`,
            warnings,
        );
        checkAndFix(
            sit,
            "tipoCustodia",
            enumDict.reu.situacaoPrisional_tipoCustodia,
            `${path}.situacaoPrisional`,
            warnings,
        );
    }

    const ant = reu.antecedentesCriminais;
    if (ant) {
        checkAndFix(
            ant,
            "tipo",
            enumDict.reu.antecedentesCriminais_tipo,
            `${path}.antecedentesCriminais`,
            warnings,
        );
    }

    for (const [ci, crime] of (reu.crimesImputados ?? []).entries()) {
        const cp = `${path}.crimesImputados[${ci}]`;
        checkAndFix(
            crime,
            "modalidadeConsumacao",
            enumDict.crime.modalidadeConsumacao,
            cp,
            warnings,
        );
        checkAndFix(
            crime,
            "modalidadeSubjetiva",
            enumDict.crime.modalidadeSubjetiva,
            cp,
            warnings,
        );
    }

    for (const [ci, crime] of (reu.crimesCondenado ?? []).entries()) {
        const cp = `${path}.crimesCondenado[${ci}]`;
        checkAndFix(
            crime,
            "modalidadeConsumacao",
            enumDict.crime.modalidadeConsumacao,
            cp,
            warnings,
        );
        checkAndFix(
            crime,
            "modalidadeSubjetiva",
            enumDict.crime.modalidadeSubjetiva,
            cp,
            warnings,
        );

        const f1 = crime.fase1_PenaBase;
        if (f1?.vetores) {
            for (const [vk, vetor] of Object.entries(f1.vetores)) {
                if (!vetor || typeof vetor !== "object") continue;
                const vp = `${cp}.fase1_PenaBase.vetores.${vk}`;
                checkAndFix(
                    vetor,
                    "valoracao",
                    enumDict.fase1.valoracao,
                    vp,
                    warnings,
                );
                if (vk === "antecedentes") {
                    checkAndFix(
                        vetor,
                        "subcategoria",
                        enumDict.fase1.antecedentes_subcategoria,
                        vp,
                        warnings,
                    );
                }
            }
        }

        const f2 = crime.fase2_PenaIntermediaria;
        if (f2) {
            const f2p = `${cp}.fase2_PenaIntermediaria`;
            checkArrayEnum(
                f2.agravantesReconhecidas,
                enumDict.fase2.agravantesReconhecidas,
                `${f2p}.agravantesReconhecidas`,
                warnings,
            );
            checkArrayEnum(
                f2.atenuantesReconhecidas,
                enumDict.fase2.atenuantesReconhecidas,
                `${f2p}.atenuantesReconhecidas`,
                warnings,
            );
            checkAndFix(
                f2,
                "compensacaoIntegral",
                enumDict.fase2.compensacaoIntegral,
                f2p,
                warnings,
            );
            checkAndFix(
                f2,
                "agravantePreponderante",
                enumDict.fase2.agravantePreponderante,
                f2p,
                warnings,
            );
            const fracoesValidas = [...enumDict.fase2.fracoes_permitidas, null];
            checkAndFix(f2, "fracaoAgravamento", fracoesValidas, f2p, warnings);
            checkAndFix(f2, "fracaoAtenuamento", fracoesValidas, f2p, warnings);
        }

        const f3 = crime.fase3_PenaDefinitiva;
        if (f3) {
            const f3p = `${cp}.fase3_PenaDefinitiva`;
            const allAumento = [...causas.aumento];
            const allDiminuicao = [...causas.diminuicao];
            checkArrayEnum(
                f3.causasAumentoReconhecidas,
                allAumento,
                `${f3p}.causasAumentoReconhecidas`,
                warnings,
            );
            checkArrayEnum(
                f3.causasDiminuicaoReconhecidas,
                allDiminuicao,
                `${f3p}.causasDiminuicaoReconhecidas`,
                warnings,
            );
            checkAndFix(
                f3,
                "tentativaReconhecida",
                enumDict.fase3.tentativaReconhecida,
                f3p,
                warnings,
            );
            checkAndFix(
                f3,
                "fracaoTentativa",
                [...enumDict.fase3.fracoesTentativa, null],
                f3p,
                warnings,
            );

            // Valida fração de aumento contra o intervalo legal de cada causa
            if (
                f3.fracaoAumento &&
                f3.causasAumentoReconhecidas?.length === 1
            ) {
                validarFracao(
                    f3.fracaoAumento,
                    f3.causasAumentoReconhecidas[0],
                    "aumento",
                    f3p,
                    warnings,
                );
            }
            // Valida fração de diminuição contra o intervalo legal de cada causa
            if (
                f3.fracaoDiminuicao &&
                f3.causasDiminuicaoReconhecidas?.length === 1
            ) {
                validarFracao(
                    f3.fracaoDiminuicao,
                    f3.causasDiminuicaoReconhecidas[0],
                    "diminuicao",
                    f3p,
                    warnings,
                );
            }

            // Valida coerência causa×crime
            if (crime.dispositivoLegal) {
                const parsed = parsearDispositivo(crime.dispositivoLegal);
                for (const causa of f3.causasAumentoReconhecidas ?? []) {
                    const dosi = dosimetria().causasAumento?.[causa];
                    if (!dosi || (!dosi.aplicavelALeis && !dosi.aplicavelAArts))
                        continue;
                    const leiOk =
                        !dosi.aplicavelALeis ||
                        (parsed && dosi.aplicavelALeis.includes(parsed.slug));
                    const artOk =
                        !dosi.aplicavelAArts ||
                        (parsed && dosi.aplicavelAArts.includes(parsed.artKey));
                    if (!leiOk || !artOk) {
                        warnings.push(
                            `[INCOERÊNCIA] ${f3p}: causa "${causa}" (${dosi.dispositivo}) não é aplicável ao crime "${crime.dispositivoLegal}"`,
                        );
                    }
                }
            }

            // Alerta: art. 121 §7 foi revogado — o feminicídio agora é art. 121-A
            if (
                f3.causasAumentoReconhecidas?.includes(
                    "art121_par7_feminicidio_majorantes",
                )
            ) {
                warnings.push(
                    `[ATENÇÃO LEGISLAÇÃO] ${f3p}: "art121_par7_feminicidio_majorantes" — o art. 121 §7 foi REVOGADO pela Lei 14.994/2024. Feminicídio agora é tipo autônomo (art. 121-A CP, pena 20-40 anos).`,
                );
            }
        }
    }

    const cc = reu.concursoDeCrimes;
    if (cc) {
        checkAndFix(
            cc,
            "regraAplicada",
            enumDict.concursoDeCrimes.regraAplicada,
            `${path}.concursoDeCrimes`,
            warnings,
        );
        checkAndFix(
            cc,
            "fracaoExasperacao",
            enumDict.concursoDeCrimes.fracaoExasperacao,
            `${path}.concursoDeCrimes`,
            warnings,
        );
    }

    const exec = reu.execucaoDaPena;
    if (exec) {
        const ep = `${path}.execucaoDaPena`;
        checkAndFix(
            exec,
            "regimeInicial",
            enumDict.execucaoDaPena.regimeInicial,
            ep,
            warnings,
        );
        checkAndFix(
            exec,
            "prescricaoReconhecida",
            enumDict.prescricao.prescricaoReconhecida,
            ep,
            warnings,
        );

        for (const [pi, per] of (exec.detracao?.periodos ?? []).entries()) {
            checkAndFix(
                per,
                "modalidade",
                enumDict.execucaoDaPena.detracao_periodos_modalidade,
                `${ep}.detracao.periodos[${pi}]`,
                warnings,
            );
        }

        const prd = exec.substituicaoPRD;
        if (prd) {
            checkAndFix(
                prd,
                "concedida",
                enumDict.execucaoDaPena.substituicaoPRD_concedida,
                `${ep}.substituicaoPRD`,
                warnings,
            );
            checkAndFix(
                prd,
                "quantidadePenas",
                enumDict.execucaoDaPena.substituicaoPRD_quantidadePenas,
                `${ep}.substituicaoPRD`,
                warnings,
            );
            checkArrayEnum(
                prd.especiesAplicadas,
                enumDict.execucaoDaPena.substituicaoPRD_especiesAplicadas,
                `${ep}.substituicaoPRD.especiesAplicadas`,
                warnings,
            );
        }

        const sursis = exec.sursisPenal;
        if (sursis) {
            checkAndFix(
                sursis,
                "concedido",
                enumDict.execucaoDaPena.sursisPenal_concedido,
                `${ep}.sursisPenal`,
                warnings,
            );
            checkAndFix(
                sursis,
                "especieAplicada",
                enumDict.execucaoDaPena.sursisPenal_especieAplicada,
                `${ep}.sursisPenal`,
                warnings,
            );
            checkAndFix(
                sursis,
                "prazoAnos",
                enumDict.execucaoDaPena.sursisPenal_prazoAnos,
                `${ep}.sursisPenal`,
                warnings,
            );
        }

        const rep = exec.reparacaoDanosArt387IV;
        if (rep) {
            checkAndFix(
                rep,
                "destinatario",
                enumDict.execucaoDaPena.reparacaoDanos_destinatario,
                `${ep}.reparacaoDanosArt387IV`,
                warnings,
            );
        }
    }
}

function validarMeiosDeProva(meios, enumDict, warnings) {
    if (!Array.isArray(meios)) return;
    for (const [i, m] of meios.entries()) {
        const p = `grau1.fundamentacaoCondenatoria.meiosDeProva[${i}]`;
        checkAndFix(m, "tipo", enumDict.meiosDeProva?.tipo ?? [], p, warnings);
        checkArrayEnum(
            m.usadoPara,
            enumDict.meiosDeProva?.usadoPara ?? [],
            `${p}.usadoPara`,
            warnings,
        );
        checkAndFix(
            m,
            "resultado",
            enumDict.meiosDeProva?.resultado ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "pericia_tipoExame",
            enumDict.meiosDeProva?.pericia_tipoExame ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "pericia_conclusao",
            enumDict.meiosDeProva?.pericia_conclusao ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "interrogatorio_direito_silencio",
            enumDict.meiosDeProva?.interrogatorio_direito_silencio ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "confissao_tipo",
            enumDict.meiosDeProva?.confissao_tipo ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "confissao_momento",
            enumDict.meiosDeProva?.confissao_momento ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "testemunha_qualificacao",
            enumDict.meiosDeProva?.testemunha_qualificacao ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "testemunha_tipoPercepcao",
            enumDict.meiosDeProva?.testemunha_tipoPercepcao ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "testemunha_fase",
            enumDict.meiosDeProva?.testemunha_fase ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "reconhecimento_modalidade",
            enumDict.meiosDeProva?.reconhecimento_modalidade ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "reconhecimento_procedimentoLegal_Art226",
            enumDict.meiosDeProva?.reconhecimento_procedimentoLegal_Art226 ??
                [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "documento_tipo",
            enumDict.meiosDeProva?.documento_tipo ?? [],
            p,
            warnings,
        );
    }
}

function validarMeiosDeObtencaoDeProva(meios, enumDict, warnings) {
    if (!Array.isArray(meios)) return;
    for (const [i, m] of meios.entries()) {
        const p = `grau1.fundamentacaoCondenatoria.meiosDeObtencaoDeProva[${i}]`;
        checkAndFix(
            m,
            "tipo",
            enumDict.meiosDeObtencaoDeProva?.tipo ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "autorizacaoJudicial",
            enumDict.meiosDeObtencaoDeProva?.autorizacaoJudicial ?? [],
            p,
            warnings,
        );
        checkAndFix(
            m,
            "resultado",
            enumDict.meiosDeObtencaoDeProva?.resultado ?? [],
            p,
            warnings,
        );
    }
}

function validarTese(tese, path, enumDict, warnings) {
    if (!tese || typeof tese !== "object") return;
    const tesesPadronizadas = enumDict.teses?.teses_padronizadas ?? [];
    if (tese.tese !== null && !tesesPadronizadas.includes(tese.tese)) {
        warnings.push(
            `[ENUM inválido] ${path}.tese = "${tese.tese}" — substituído por null`,
        );
        tese.tese = null;
    }
    checkAndFix(
        tese,
        "suscitadaPor",
        enumDict.teses?.suscitadaPor ?? [],
        path,
        warnings,
    );
    checkAndFix(tese, "fase", enumDict.teses?.fase ?? [], path, warnings);
    checkAndFix(
        tese,
        "resultado",
        enumDict.teses?.resultado ?? [],
        path,
        warnings,
    );
}

function validarGrau2(grau2, enumDict, warnings) {
    if (!grau2) return;

    for (const [ri, rec] of (grau2.recursos ?? []).entries()) {
        const rp = `grau2.recursos[${ri}]`;
        checkAndFix(rec, "tipo", enumDict.recursos.tipo, rp, warnings);
        checkArrayEnum(
            rec.efeitos,
            enumDict.recursos.efeitos,
            `${rp}.efeitos`,
            warnings,
        );
        checkAndFix(
            rec,
            "resultado",
            enumDict.recursos.resultado,
            rp,
            warnings,
        );
        for (const [ti, tese] of (rec.tesesEstruturadas ?? []).entries()) {
            validarTese(
                tese,
                `${rp}.tesesEstruturadas[${ti}]`,
                enumDict,
                warnings,
            );
        }
        if (
            rec.recorrente !== null &&
            !isValidRecorrente(rec.recorrente, enumDict)
        ) {
            warnings.push(
                `[ENUM inválido] ${rp}.recorrente = "${rec.recorrente}" — substituído por null`,
            );
            rec.recorrente = null;
        }
    }

    const pgj = grau2.parecerPGJ;
    if (pgj) {
        checkAndFix(
            pgj,
            "teor",
            enumDict.parecerPGJ.teor,
            "grau2.parecerPGJ",
            warnings,
        );
    }

    const acordao = grau2.acordao;
    if (acordao) {
        checkAndFix(
            acordao,
            "votacao",
            enumDict.acordao.votacao,
            "grau2.acordao",
            warnings,
        );
        checkAndFix(
            acordao,
            "novoRegimeInicial",
            enumDict.acordao.novoRegimeInicial,
            "grau2.acordao",
            warnings,
        );
        for (const [ri, res] of (acordao.resultadoPorRecurso ?? []).entries()) {
            checkAndFix(
                res,
                "decisao",
                enumDict.acordao.resultadoPorRecurso_decisao,
                `grau2.acordao.resultadoPorRecurso[${ri}]`,
                warnings,
            );
        }
    }
}

function gerarAlertas(json, enumDict) {
    const alertas = [];
    const grau1 = json.grau1;
    if (!grau1) return alertas;

    for (const reu of grau1.reus ?? []) {
        const nome = reu.nome ?? "réu desconhecido";

        for (const crime of reu.crimesCondenado ?? []) {
            const ant = crime.fase1_PenaBase?.vetores?.antecedentes;
            if (
                ant?.subcategoria === "processos_em_curso_indevido_sumula_444"
            ) {
                alertas.push(
                    `[ALERTA Súmula 444 STJ] ${nome}: antecedentes negativos baseados em processos em curso — uso indevido.`,
                );
            }
            if (ant?.subcategoria === "condenacao_apos_5_anos_sumula_636") {
                alertas.push(
                    `[ALERTA Súmula 636 STJ] ${nome}: condenação anterior usada como antecedente após 5 anos — possível uso indevido.`,
                );
            }
            if (ant?.subcategoria === "atos_infracionais_indevidos") {
                alertas.push(
                    `[ALERTA] ${nome}: atos infracionais usados como antecedentes negativos — uso indevido.`,
                );
            }

            const f2 = crime.fase2_PenaIntermediaria;
            if (f2) {
                const temConfissao =
                    f2.atenuantesReconhecidas?.includes(
                        "confissao_espontanea",
                    ) ||
                    f2.atenuantesReconhecidas?.includes(
                        "confissao_qualificada_sumula_545_stj",
                    );
                const temReincidencia = f2.agravantesReconhecidas?.some((a) =>
                    a?.startsWith("reincidencia"),
                );
                if (
                    temConfissao &&
                    temReincidencia &&
                    f2.compensacaoIntegral === false
                ) {
                    alertas.push(
                        `[ALERTA Súmula 545 STJ] ${nome}: confissão + reincidência sem compensação integral — verificar.`,
                    );
                }
            }
        }

        const exec = reu.execucaoDaPena;
        if (exec?.reparacaoDanosArt387IV?.houvePedidoExpresso === false) {
            alertas.push(
                `[ALERTA Súmula 588 STJ] ${nome}: reparação de danos fixada sem pedido expresso.`,
            );
        }

        const risco = reu.calculoPrescricao?.risco;
        if (["alto", "iminente", "configurada"].includes(risco)) {
            alertas.push(`[ALERTA PRESCRIÇÃO] ${nome}: risco = ${risco}.`);
        }
    }

    return alertas;
}

/**
 * Valida o JSON extraído pela IA.
 * Retorna { json, warnings, alertas }
 */
export function validar(json, enumDict) {
    const warnings = [];
    const causas = buildCausasSet(enumDict);

    // Avisa se seções críticas do enum estiverem ausentes — evita validação silenciosa
    for (const secao of ["meiosDeProva", "meiosDeObtencaoDeProva", "teses"]) {
        if (!enumDict[secao]) {
            warnings.push(
                `[ENUM ausente] Seção "${secao}" não encontrada no enum.json — validação dessa seção ignorada`,
            );
        }
    }

    checkAndFix(
        json,
        "statusProcesso",
        enumDict.statusProcesso,
        "root",
        warnings,
    );
    checkAndFix(json, "competencia", enumDict.competencia, "root", warnings);

    for (const [ri, reu] of (json.grau1?.reus ?? []).entries()) {
        validarReu(reu, `grau1.reus[${ri}]`, enumDict, causas, warnings);
    }

    for (const [ti, tese] of (json.grau1?.alegacoesGrau1 ?? []).entries()) {
        validarTese(tese, `grau1.alegacoesGrau1[${ti}]`, enumDict, warnings);
    }

    const fund = json.grau1?.fundamentacaoCondenatoria;
    if (fund) {
        validarMeiosDeProva(fund.meiosDeProva, enumDict, warnings);
        validarMeiosDeObtencaoDeProva(
            fund.meiosDeObtencaoDeProva,
            enumDict,
            warnings,
        );
    }

    validarGrau2(json.grau2, enumDict, warnings);

    const meta = json.metadados;
    if (meta) {
        checkAndFix(
            meta,
            "preenchidoPor",
            enumDict.metadados.preenchidoPor,
            "metadados",
            warnings,
        );
        checkAndFix(
            meta,
            "acordoNaoPersecucaoPenal",
            enumDict.metadados.acordoNaoPersecucaoPenal,
            "metadados",
            warnings,
        );
        checkAndFix(
            meta,
            "suspensaoCondicionalProcesso",
            enumDict.metadados.suspensaoCondicionalProcesso,
            "metadados",
            warnings,
        );
    }

    const alertas = gerarAlertas(json, enumDict);
    return { json, warnings, alertas };
}
