/**
 * Cálculos determinísticos — prescrição, totalDias, súmulas violadas, penas abstratas.
 * Esses campos NÃO são preenchidos pela IA; são computados aqui.
 */

import { lookupPena, penaTotalDias, parsearDispositivo } from "./lei-lookup.js";
import { determinarLeiVigente } from "./lei-tempo.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
let _dosimetria = null;
function dosimetria() {
    if (!_dosimetria) {
        const p = path.join(__dir, "..", "leis", "index_dosimetria.json");
        _dosimetria = JSON.parse(fs.readFileSync(p, "utf8"));
    }
    return _dosimetria;
}

// Prazos prescricionais art. 109 CP (pena em dias → prazo em anos)
const TABELA_PRESCRICAO = [
    { penaMinimaExclusivaEmDias: 12 * 365 + 1, prazoAnos: 20 },
    { penaMinimaExclusivaEmDias: 8 * 365 + 1, prazoAnos: 16 },
    { penaMinimaExclusivaEmDias: 4 * 365 + 1, prazoAnos: 12 },
    { penaMinimaExclusivaEmDias: 2 * 365 + 1, prazoAnos: 8 },
    { penaMinimaExclusivaEmDias: 1 * 365, prazoAnos: 4 },
    { penaMinimaExclusivaEmDias: 0, prazoAnos: 3 },
];

export function calcularTotalDias(anos, meses, dias) {
    const a = Number(anos) || 0;
    const m = Number(meses) || 0;
    const d = Number(dias) || 0;
    return a * 365 + m * 30 + d;
}

export function prazoPrescricionaiArt109(penaTotalDias) {
    for (const entrada of TABELA_PRESCRICAO) {
        if (penaTotalDias > entrada.penaMinimaExclusivaEmDias) {
            return entrada.prazoAnos;
        }
    }
    return 3;
}

// Parse DD/MM/AAAA → Date (UTC noon para evitar problemas de fuso)
function parseData(str) {
    if (!str || typeof str !== "string") return null;
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(
        Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]), 12),
    );
}

function formatData(date) {
    if (!date) return null;
    const d = String(date.getUTCDate()).padStart(2, "0");
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
}

function somarAnos(dataStr, anos) {
    const d = parseData(dataStr);
    if (!d) return null;
    const nova = new Date(d);
    nova.setUTCFullYear(nova.getUTCFullYear() + anos);
    return formatData(nova);
}

// Classifica risco de prescrição dado um prazo limite e data de hoje
export function classificarRisco(dataLimiteStr, hoje = new Date()) {
    const limite = parseData(dataLimiteStr);
    if (!limite) return null;

    const diffMs = limite.getTime() - hoje.getTime();
    const diffDias = Math.ceil(diffMs / 86_400_000);

    if (diffDias < 0) return "configurada";
    if (diffDias < 90) return "iminente";
    if (diffDias < 180) return "alto";
    if (diffDias < 365) return "medio";
    if (diffDias < 1095) return "baixo";
    return "sem_risco";
}

// Detecta possível súmula violada com base no regime e na pena total do réu
function detectarSumulaViolada(reu) {
    const exec = reu.execucaoDaPena;
    if (!exec) return null;

    const regime = exec.regimeInicial;
    if (!regime) return null;

    const penaDias =
        reu.concursoDeCrimes?.penaTotalPrivativa?.totalDias ??
        obterPenaDefinitivaDias(reu);

    if (!penaDias) return null;

    const isReincidente = [
        "reincidente_generico",
        "reincidente_especifico",
        "multireincidente",
    ].includes(reu.antecedentesCriminais?.tipo);

    const temFundamentoGravoso = !!exec.fundamentoRegimeMaisGravoso;

    // Régimes permitidos pelo art. 33 §2° CP (sem considerar crimes hediondos)
    // Pena > 8 anos → fechado obrigatório
    // 4 < pena ≤ 8 → semiaberto (primário) ou fechado (reincidente)
    // pena ≤ 4 → aberto (primário) ou semiaberto (reincidente)
    const penaAnos = penaDias / 365;

    if (
        penaAnos <= 4 &&
        regime === "fechado" &&
        !isReincidente &&
        !temFundamentoGravoso
    ) {
        return "sumula_718_stf";
    }
    if (penaAnos <= 4 && regime === "fechado" && !temFundamentoGravoso) {
        return "sumula_719_stf";
    }
    if (
        penaAnos > 4 &&
        penaAnos <= 8 &&
        regime === "fechado" &&
        !isReincidente &&
        !temFundamentoGravoso
    ) {
        return "sumula_440_stj";
    }

    return null;
}

function obterPenaDefinitivaDias(reu) {
    const crimes = reu.crimesCondenado;
    if (!crimes?.length) return null;
    // Se crime único, usa a pena definitiva do primeiro crime
    const p = crimes[0]?.fase3_PenaDefinitiva?.penaPrivativaAplicada;
    if (!p) return null;
    return calcularTotalDias(p.anos, p.meses, p.dias) || null;
}

// Preenche totalDias recursivamente em todos os objetos {anos, meses, dias, totalDias}
function preencherTotalDias(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
        obj.forEach(preencherTotalDias);
        return;
    }

    if (
        "anos" in obj &&
        "meses" in obj &&
        "dias" in obj &&
        "totalDias" in obj
    ) {
        if (obj.anos !== null || obj.meses !== null || obj.dias !== null) {
            obj.totalDias = calcularTotalDias(obj.anos, obj.meses, obj.dias);
        }
    }

    for (const val of Object.values(obj)) {
        preencherTotalDias(val);
    }
}

// Calcula totalDias de detracao por período
function calcularDetracoes(reu) {
    const detracao = reu.execucaoDaPena?.detracao;
    if (!detracao?.periodos?.length) return;

    let total = 0;
    for (const periodo of detracao.periodos) {
        const inicio = parseData(periodo.dataInicio);
        const fim = parseData(periodo.dataFim);
        if (inicio && fim) {
            // Art. 10 CP: o dia do começo inclui-se no cômputo.
            // Math.floor garante resultado inteiro mesmo com variações de horário de verão.
            const dias = Math.floor((fim - inicio) / 86_400_000) + 1;
            periodo.totalDias = Math.max(0, dias);
            total += periodo.totalDias;
        }
    }
    detracao.totalDiasDetraidos = total || null;
}

// Calcula campos de prescrição para um réu
function calcularPrescricaoReu(reu, grau1) {
    const calc = reu.calculoPrescricao;
    if (!calc) return;

    const hoje = new Date();

    // Pena máxima em abstrato (do primeiro crime condenado, ou concurso)
    const primeiroCondenado = reu.crimesCondenado?.[0];
    const penaMaxAbstrataDias =
        primeiroCondenado?.fase1_PenaBase?.penaAbstrataMaxima?.totalDias ??
        null;

    // Pena total concreta
    const penaConcretaDias =
        reu.concursoDeCrimes?.penaTotalPrivativa?.totalDias ??
        primeiroCondenado?.fase3_PenaDefinitiva?.penaPrivativaAplicada
            ?.totalDias ??
        null;

    const dataFato = grau1.dataFato;
    const dataDenuncia = grau1.dataRecebimentoDenuncia;
    const dataSentenca = grau1.dataSentenca;
    const transitoAcus = grau1.transitoAcusacao1G;

    // PPP abstrata: a partir do fato, pelo prazo da pena máxima em abstrato
    if (dataFato && penaMaxAbstrataDias) {
        const prazo = prazoPrescricionaiArt109(penaMaxAbstrataDias);
        calc.pppAbstrataDataLimite = somarAnos(dataFato, prazo);
        const limite = parseData(calc.pppAbstrataDataLimite);
        calc.pppAbstrataConfigurada = limite ? limite < hoje : null;
    }

    // PPP retroativa: a partir do recebimento da denúncia, pela pena concreta
    if (dataDenuncia && penaConcretaDias) {
        const prazo = prazoPrescricionaiArt109(penaConcretaDias);
        calc.pppRetroativaDataLimite = somarAnos(dataDenuncia, prazo);
    }

    // PPP intercorrente: a partir da data da sentença (= data de publicação), pela pena concreta
    const dataBase = dataSentenca;
    if (dataBase && penaConcretaDias) {
        const prazo = prazoPrescricionaiArt109(penaConcretaDias);
        calc.pppIntercorrenteDataLimite = somarAnos(dataBase, prazo);
    }

    // PPE: a partir do trânsito para a acusação, pela pena concreta
    if (transitoAcus && penaConcretaDias) {
        const prazo = prazoPrescricionaiArt109(penaConcretaDias);
        calc.ppeDataLimite = somarAnos(transitoAcus, prazo);
    }

    // Risco: o menor dos prazos não nulos vs. hoje
    const prazosNaoNulos = [
        calc.pppAbstrataDataLimite,
        calc.pppRetroativaDataLimite,
        calc.pppIntercorrenteDataLimite,
        calc.ppeDataLimite,
    ].filter(Boolean);

    if (prazosNaoNulos.length) {
        const datas = prazosNaoNulos.map(parseData).filter(Boolean);
        const maisProxima = datas.reduce((a, b) => (a < b ? a : b));
        calc.risco = classificarRisco(formatData(maisProxima), hoje);
    }
}

// Substitui qualquer valor "__calculado_pelo_sistema__" por null antes dos cálculos
function limparSentinel(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
        obj.forEach(limparSentinel);
        return;
    }
    for (const [k, v] of Object.entries(obj)) {
        if (v === "__calculado_pelo_sistema__") {
            obj[k] = null;
        } else limparSentinel(v);
    }
}

// Preenche fracaoAumento/Diminuicao quando há causa única com fração legal fixa
function preencherFracoesFixas(grau1) {
    const dosi = dosimetria();
    for (const reu of grau1.reus ?? []) {
        for (const crime of reu.crimesCondenado ?? []) {
            const f3 = crime.fase3_PenaDefinitiva;
            if (!f3) continue;

            // Fração de aumento: só preenche automaticamente se há exatamente UMA causa com fracaoFixa
            if (
                !f3.fracaoAumento &&
                f3.causasAumentoReconhecidas?.length === 1
            ) {
                const idx =
                    dosi.causasAumento?.[f3.causasAumentoReconhecidas[0]];
                if (idx?.fracaoFixa) f3.fracaoAumento = idx.fracaoFixa;
            }

            // Fração de diminuição: mesma lógica
            if (
                !f3.fracaoDiminuicao &&
                f3.causasDiminuicaoReconhecidas?.length === 1
            ) {
                const idx =
                    dosi.causasDiminuicao?.[f3.causasDiminuicaoReconhecidas[0]];
                if (idx?.fracaoFixa) f3.fracaoDiminuicao = idx.fracaoFixa;
            }
        }
    }
}

// Preenche penaAbstrataMinima/Maxima de cada crime a partir do dispositivoLegal,
// respeitando a lei vigente na data do fato (art. 2° CP).
function preencherPenasAbstratas(grau1) {
    const dataFato = grau1.dataFato ?? null;

    for (const reu of grau1.reus ?? []) {
        for (const crime of reu.crimesCondenado ?? []) {
            const disp = crime.dispositivoLegal;
            if (!disp) continue;

            // Verifica se há lei mais favorável posterior (lex mitior) ou se
            // a lei vigente na data do fato difere da atual (in pejus)
            let pena = lookupPena(disp);
            if (!pena || !pena.tipo) continue;

            if (dataFato) {
                const parsed = parsearDispositivo(disp);
                if (parsed) {
                    const tempoInfo = determinarLeiVigente(
                        parsed.slug,
                        parsed.artKey,
                        dataFato,
                    );
                    // Se há pena histórica calculada (lei mais favorável ou lei da data do fato)
                    if (tempoInfo.penaHistorica) {
                        const ph = tempoInfo.penaHistorica;
                        // Usar pena histórica se tiver dados válidos
                        if (
                            ph.minAnos != null ||
                            ph.minMeses != null ||
                            ph.maxAnos != null
                        ) {
                            pena = ph;
                        }
                    }
                }
            }

            const f1 = crime.fase1_PenaBase;
            if (!f1) continue;

            const dias = penaTotalDias(pena);
            if (!dias) continue;

            f1.penaAbstrataMinima = {
                anos: pena.minAnos ?? 0,
                meses: pena.minMeses ?? 0,
                dias: 0,
                totalDias: dias.minDias,
            };
            f1.penaAbstrataMaxima = {
                anos: pena.maxAnos ?? 0,
                meses: pena.maxMeses ?? 0,
                dias: 0,
                totalDias: dias.maxDias,
            };
        }
    }
}

/**
 * Ponto de entrada: recebe o JSON completo e preenche todos os campos calculados.
 * Muta o objeto in-place e retorna ele.
 */
export function calcularCamposDerivativos(json) {
    // 0. Limpa sentinels que a IA pode ter deixado
    limparSentinel(json);

    const grau1 = json.grau1;
    if (!grau1) return json;

    // 1. Penas abstratas + frações fixas determinísticas (antes do totalDias)
    preencherPenasAbstratas(grau1);
    preencherFracoesFixas(grau1);

    // 2. totalDias em todas as penas
    preencherTotalDias(json);

    // 3. Por réu: detrações, súmula violada, prescrição
    for (const reu of grau1.reus ?? []) {
        calcularDetracoes(reu);

        if (reu.execucaoDaPena) {
            reu.execucaoDaPena.sumulaViolada = detectarSumulaViolada(reu);
        }

        calcularPrescricaoReu(reu, grau1);
    }

    // 3. totalDias do acórdão (grau2)
    if (json.grau2?.acordao?.novaPenaTotal) {
        const p = json.grau2.acordao.novaPenaTotal;
        if (p.anos !== null || p.meses !== null || p.dias !== null) {
            p.totalDias = calcularTotalDias(p.anos, p.meses, p.dias);
        }
    }

    return json;
}
