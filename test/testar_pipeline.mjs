// Simula a extração da sentença de Rio Negrinho e roda o pipeline completo
import { validar } from "../src/validator.js";
import { calcularCamposDerivativos } from "../src/calculator.js";
import { verificarLeiTempoJSON } from "../src/lei-tempo.js";
import { parsearDispositivo } from "../src/lei-lookup.js";
import { readFileSync, writeFileSync } from "fs";

const enumDict = JSON.parse(readFileSync("./enum.json", "utf-8"));

const jsonIA = {
    numProcesso: "5001399-88.2025.8.24.0541",
    versaoSchema: 7,
    atualizadoEm: null,
    statusProcesso: "sentenciado_aguardando_recursos",
    competencia: "criminal_drogas",

    grau1: {
        dataFato: "11/07/2025",
        dataRecebimentoDenuncia: null,
        dataSentenca: "18/02/2026",
        juizSentenciante: "Rodrigo Clímaco José",
        varaOrigem: "2ª Vara da Comarca de Rio Negrinho",
        idEventoSentenca: null,
        vitimas: [
            { nome: "A Coletividade", vulnerabilidade: "coletividade", relacaoComReu: null }
        ],

        reus: [
            {
                nome: "Kelly Floriano Vitencour",
                cpfMascarado: null,
                dataNascimento: null,
                tipoDefesa: "privada",
                situacaoPrisional: {
                    estadoAtual: "liberdade",
                    tipoCustodia: null,
                    dataInicioCustodia: null,
                },
                antecedentesCriminais: {
                    possui: false,
                    tipo: "primario_sem_antecedentes",
                    processosCitados: [],
                },
                crimesImputados: [
                    {
                        dispositivoLegal: "art. 33, caput, Lei 11.343/2006",
                        tipoCrime: "Tráfico de drogas",
                        modalidadeConsumacao: "consumado",
                        modalidadeSubjetiva: "doloso",
                    },
                ],
                resultado: "condenado_integralmente",
                crimesCondenado: [
                    {
                        tipoCrime: "Tráfico de drogas",
                        dispositivoLegal:
                            "art. 33, caput e §4º, Lei 11.343/2006",
                        modalidadeConsumacao: "consumado",
                        idEventoDosimetria: null,
                        fase1_PenaBase: {
                            vetores: {
                                culpabilidade: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                antecedentes: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                    subcategoria: null,
                                },
                                condutaSocial: {
                                    valoracao: "nao_mencionada",
                                    fundamento: null,
                                },
                                personalidade: {
                                    valoracao: "nao_mencionada",
                                    fundamento: null,
                                },
                                motivos: {
                                    valoracao: "neutra",
                                    fundamento:
                                        "o motivo do crime foi o lucro por meio do tráfico de drogas, mas deixo de considerar por ser inerente ao tipo",
                                },
                                circunstancias: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                consequencias: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                comportamentoVitima: {
                                    valoracao: null,
                                    fundamento: null,
                                },
                                naturezaQuantidadeDrogaArt42: {
                                    valoracao: null,
                                    fundamento: null,
                                },
                            },
                            quantidadeVetoresNegativos: 0,
                            fracaoAumentoPorVetorial: null,
                            penaAbstrataMinima: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaAbstrataMaxima: {
                                anos: 15,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaPrivativaAplicada: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 500,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                        fase2_PenaIntermediaria: {
                            agravantesReconhecidas: [],
                            atenuantesReconhecidas: [],
                            compensacaoIntegral: null,
                            agravantePreponderante: null,
                            fracaoAgravamento: null,
                            fracaoAtenuamento: null,
                            penaPrivativaAplicada: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 500,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                        fase3_PenaDefinitiva: {
                            causasAumentoReconhecidas: [],
                            fracaoAumento: null,
                            causasDiminuicaoReconhecidas: [
                                "art33_par4_trafico_privilegiado",
                            ],
                            fracaoDiminuicao: "1/6",
                            tentativaReconhecida: false,
                            fracaoTentativa: null,
                            penaPrivativaAplicada: {
                                anos: 4,
                                meses: 2,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 417,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                    },
                ],
                concursoDeCrimes: {
                    regraAplicada: "crime_unico",
                    quantidadeCrimesConcorrentes: 1,
                    fracaoExasperacao: null,
                    penaTotalPrivativa: {
                        anos: 4,
                        meses: 2,
                        dias: 0,
                        totalDias: null,
                    },
                    penaTotalMulta: {
                        diasMulta: 417,
                        valorDiaMulta: null,
                        valorTotal: null,
                    },
                },
                execucaoDaPena: {
                    detracao: {
                        periodos: [],
                        totalDiasDetraidos: null,
                        consideradaParaRegime: null,
                    },
                    regimeInicial: "semiaberto",
                    fundamentoRegimeMaisGravoso: null,
                    sumulaViolada: null,
                    substituicaoPRD: {
                        concedida: false,
                        quantidadePenas: null,
                        especiesAplicadas: [],
                        fundamentoNegativa:
                            "pena superior a 4 anos (CP, art. 44, I)",
                    },
                    sursisPenal: {
                        concedido: false,
                        especieAplicada: null,
                        prazoAnos: null,
                        fundamentoNegativa: "pena ultrapassa 2 anos",
                        condicoes: [],
                    },
                    condicoesRegimeAberto: [],
                    bensApreendidos: [],
                    statusLiberdadeRecursal: {
                        concedidoLiberdade: true,
                        impostoCautelarDiversa: null,
                        manidaPrisaoPreventiva: null,
                        fundamento: null,
                    },
                    reparacaoDanosArt387IV: {
                        fixada: false,
                        valorMinimo: null,
                        destinatario: null,
                        houvePedidoExpresso: null,
                    },
                    custasProcessuais: {
                        condenado: true,
                        isencaoPorMiserabilidade: false,
                    },
                    prescricaoReconhecida: null,
                    fundamentoPrescricao: null,
                },
                calculoPrescricao: {
                    pppAbstrataDataLimite: null,
                    pppAbstrataConfigurada: null,
                    pppRetroativaDataLimite: null,
                    pppIntercorrenteDataLimite: null,
                    ppeDataLimite: null,
                    risco: null,
                },
            },
            {
                nome: "Vabili Dariane de Moraes",
                cpfMascarado: null,
                dataNascimento: null,
                tipoDefesa: "privada",
                situacaoPrisional: {
                    estadoAtual: "liberdade",
                    tipoCustodia: null,
                    dataInicioCustodia: null,
                },
                antecedentesCriminais: {
                    possui: false,
                    tipo: "primario_sem_antecedentes",
                    processosCitados: [],
                },
                crimesImputados: [
                    {
                        dispositivoLegal: "art. 33, caput, Lei 11.343/2006",
                        tipoCrime: "Tráfico de drogas",
                        modalidadeConsumacao: "consumado",
                        modalidadeSubjetiva: "doloso",
                    },
                ],
                resultado: "condenado_integralmente",
                crimesCondenado: [
                    {
                        tipoCrime: "Tráfico de drogas",
                        dispositivoLegal:
                            "art. 33, caput e §4º, Lei 11.343/2006",
                        modalidadeConsumacao: "consumado",
                        idEventoDosimetria: null,
                        fase1_PenaBase: {
                            vetores: {
                                culpabilidade: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                antecedentes: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                    subcategoria: null,
                                },
                                condutaSocial: {
                                    valoracao: "nao_mencionada",
                                    fundamento: null,
                                },
                                personalidade: {
                                    valoracao: "nao_mencionada",
                                    fundamento: null,
                                },
                                motivos: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                circunstancias: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                consequencias: {
                                    valoracao: "neutra",
                                    fundamento: null,
                                },
                                comportamentoVitima: {
                                    valoracao: null,
                                    fundamento: null,
                                },
                                naturezaQuantidadeDrogaArt42: {
                                    valoracao: null,
                                    fundamento: null,
                                },
                            },
                            quantidadeVetoresNegativos: 0,
                            fracaoAumentoPorVetorial: null,
                            penaAbstrataMinima: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaAbstrataMaxima: {
                                anos: 15,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaPrivativaAplicada: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 500,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                        fase2_PenaIntermediaria: {
                            agravantesReconhecidas: [],
                            atenuantesReconhecidas: [],
                            compensacaoIntegral: null,
                            agravantePreponderante: null,
                            fracaoAgravamento: null,
                            fracaoAtenuamento: null,
                            penaPrivativaAplicada: {
                                anos: 5,
                                meses: 0,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 500,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                        fase3_PenaDefinitiva: {
                            causasAumentoReconhecidas: [],
                            fracaoAumento: null,
                            causasDiminuicaoReconhecidas: [
                                "art33_par4_trafico_privilegiado",
                            ],
                            fracaoDiminuicao: "1/6",
                            tentativaReconhecida: false,
                            fracaoTentativa: null,
                            penaPrivativaAplicada: {
                                anos: 4,
                                meses: 2,
                                dias: 0,
                                totalDias: null,
                            },
                            penaMultaAplicada: {
                                diasMulta: 417,
                                valorDiaMulta: null,
                                valorTotal: null,
                            },
                        },
                    },
                ],
                concursoDeCrimes: {
                    regraAplicada: "crime_unico",
                    quantidadeCrimesConcorrentes: 1,
                    fracaoExasperacao: null,
                    penaTotalPrivativa: {
                        anos: 4,
                        meses: 2,
                        dias: 0,
                        totalDias: null,
                    },
                    penaTotalMulta: {
                        diasMulta: 417,
                        valorDiaMulta: null,
                        valorTotal: null,
                    },
                },
                execucaoDaPena: {
                    detracao: {
                        periodos: [],
                        totalDiasDetraidos: null,
                        consideradaParaRegime: null,
                    },
                    regimeInicial: "semiaberto",
                    fundamentoRegimeMaisGravoso: null,
                    sumulaViolada: null,
                    substituicaoPRD: {
                        concedida: false,
                        quantidadePenas: null,
                        especiesAplicadas: [],
                        fundamentoNegativa:
                            "pena superior a 4 anos (CP, art. 44, I)",
                    },
                    sursisPenal: {
                        concedido: false,
                        especieAplicada: null,
                        prazoAnos: null,
                        fundamentoNegativa: "pena ultrapassa 2 anos",
                        condicoes: [],
                    },
                    condicoesRegimeAberto: [],
                    bensApreendidos: [],
                    statusLiberdadeRecursal: {
                        concedidoLiberdade: true,
                        impostoCautelarDiversa: null,
                        manidaPrisaoPreventiva: null,
                        fundamento: null,
                    },
                    reparacaoDanosArt387IV: {
                        fixada: false,
                        valorMinimo: null,
                        destinatario: null,
                        houvePedidoExpresso: null,
                    },
                    custasProcessuais: {
                        condenado: true,
                        isencaoPorMiserabilidade: false,
                    },
                    prescricaoReconhecida: null,
                    fundamentoPrescricao: null,
                },
                calculoPrescricao: {
                    pppAbstrataDataLimite: null,
                    pppAbstrataConfigurada: null,
                    pppRetroativaDataLimite: null,
                    pppIntercorrenteDataLimite: null,
                    ppeDataLimite: null,
                    risco: null,
                },
            },
        ],

        recursosMP: {
            interposto: null,
            dataInterposicao: null,
            tempestivo: null,
            objeto: [],
        },
        recursosDefesa: [],
        transitoAcusacao1G: null,
        embargosDeclaratorios1G: [],

        alegacoesGrau1: [
            {
                tese: "nulidade_ausencia_aviso_miranda",
                teseTextoLivre:
                    "Nulidade do interrogatório policial realizado sem advogado",
                suscitadaPor: "defesa",
                reuRelacionado: "Kelly Floriano Vitencour",
                fase: "merito",
                resultado: "rejeitada",
                fundamentoDecisao:
                    "Ausência de advogado no interrogatório policial não gera nulidade automática; interrogatório judicial realizado com observância do contraditório",
            },
            {
                tese: "absolvicao_atipicidade",
                teseTextoLivre: "Absolvição por insuficiência probatória",
                suscitadaPor: "defesa",
                reuRelacionado: "Vabili Dariane de Moraes",
                fase: "merito",
                resultado: "rejeitada",
                fundamentoDecisao:
                    "Autoria e materialidade demonstradas pela prova pericial e testemunhal",
            },
        ],

        fundamentacaoCondenatoria: {
            materialidade: {
                demonstrada: true,
                elementosTextuais: [
                    "Laudo de constatação provisória",
                    "Laudo definitivo de entorpecentes — substância identificada como cocaína (30g)",
                ],
            },
            autoriaPorReu: [
                {
                    reuNome: "Kelly Floriano Vitencour",
                    demonstrada: true,
                    elementosTextuais: [
                        "Flagrante lavrado pelos policiais militares",
                        "Substância encontrada em sua residência",
                    ],
                },
                {
                    reuNome: "Vabili Dariane de Moraes",
                    demonstrada: true,
                    elementosTextuais: [
                        "Flagrante lavrado pelos policiais militares",
                        "Conduta de guarda confirmada pelas testemunhas",
                    ],
                },
            ],
            meiosDeProva: [
                {
                    tipo: "pericia_corpo_delito",
                    descricao:
                        "Laudo definitivo de entorpecentes n. 1234/2025 — substância identificada como cocaína, 30g",
                    usadoPara: ["materialidade"],
                    reuRelacionado: null,
                    questionadoPelaDefesa: false,
                    resultado: "confirmou_materialidade",
                    pericia_tipoExame: "direto",
                    pericia_cadeiaPreservada: true,
                    pericia_conclusao: "conclusivo_materialidade",
                    interrogatorio_direito_silencio: null,
                    confissao_tipo: null,
                    confissao_momento: null,
                    testemunha_nome: null,
                    testemunha_qualificacao: null,
                    testemunha_tipoPercepcao: null,
                    testemunha_fase: null,
                    reconhecimento_modalidade: null,
                    reconhecimento_procedimentoLegal_Art226: null,
                    documento_tipo: null,
                    documento_cadeiaDigitalAdequada: null,
                    indicio_fatoBase: null,
                    indicio_fatoInferido: null,
                    observacoes: null,
                },
                {
                    tipo: "prova_testemunhal",
                    descricao:
                        "Depoimento dos policiais militares que realizaram o flagrante",
                    usadoPara: ["autoria"],
                    reuRelacionado: null,
                    questionadoPelaDefesa: true,
                    resultado: "confirmou_autoria",
                    pericia_tipoExame: null,
                    pericia_cadeiaPreservada: null,
                    pericia_conclusao: null,
                    interrogatorio_direito_silencio: null,
                    confissao_tipo: null,
                    confissao_momento: null,
                    testemunha_nome: null,
                    testemunha_qualificacao: "compromissada",
                    testemunha_tipoPercepcao: "direta_visual",
                    testemunha_fase: "apenas_juizo",
                    reconhecimento_modalidade: null,
                    reconhecimento_procedimentoLegal_Art226: null,
                    documento_tipo: null,
                    documento_cadeiaDigitalAdequada: null,
                    indicio_fatoBase: null,
                    indicio_fatoInferido: null,
                    observacoes:
                        "Depoimentos coerentes entre si e com o auto de prisão em flagrante",
                },
            ],
            meiosDeObtencaoDeProva: [],
        },
    },

    grau2: {
        recursos: [],
        parecerPGJ: {
            teor: null,
            data: null,
            idEventoParecer: null,
            argumentosPrincipais: [],
        },
        embargosDeclaratorios2G: [],
        acordao: {
            data: null,
            relator: null,
            redatorAcordao: null,
            orgaoJulgador: null,
            votacao: null,
            ementa: null,
            resultadoPorRecurso: [],
            dosimetriaModificada: null,
            novaPenaTotal: {
                anos: null,
                meses: null,
                dias: null,
                totalDias: null,
            },
            novoRegimeInicial: null,
            sumulasETemasCitados: [],
            transitoEmJulgadoFinal: null,
        },
        transitoAcusacao2G: null,
        prescricaoAReconhecer: {
            configurada: null,
            especie: null,
            fundamento: null,
            dataLimitePrescricional: null,
        },
    },

    metadados: {
        preenchidoPor: "ia",
        confianca: 0.91,
        observacoes:
            "Sentença de 1G. Dois réus com dosimetria idêntica. Tráfico privilegiado (art.33 §4º) com fração 1/6. Ausência de data de recebimento da denúncia no texto.",
        acordoNaoPersecucaoPenal: "nao_aplicavel",
        suspensaoCondicionalProcesso: "nao_aplicavel",
        modeloIA: null,
        tokensConsumidos: null,
        ultimaExtracaoIA: null,
    },
};

const { json: jv, warnings, alertas } = validar(jsonIA, enumDict);
const jf = calcularCamposDerivativos(jv);
const alertasLeiTempo = verificarLeiTempoJSON(jf, parsearDispositivo);
alertas.push(...alertasLeiTempo);

console.log("=== PIPELINE: 0 erros esperados ===\n");
console.log("Warnings:", warnings.length);
warnings.forEach((w) => console.log(" W:", w));
console.log("Alertas:", alertas.length);
alertas.forEach((a) => console.log(" A:", a));

for (const reu of jf.grau1.reus) {
    const p = reu.concursoDeCrimes.penaTotalPrivativa;
    const c = reu.calculoPrescricao;
    console.log(`\n--- ${reu.nome} ---`);
    console.log(`  pena total: ${p.anos}a ${p.meses}m = ${p.totalDias} dias`);
    console.log(`  pppAbstrataDataLimite:      ${c.pppAbstrataDataLimite}`);
    console.log(
        `  pppIntercorrenteDataLimite: ${c.pppIntercorrenteDataLimite}`,
    );
    console.log(`  risco prescrição:           ${c.risco}`);
}

jf.metadados.modeloIA = "simulado/manual";
jf.metadados.ultimaExtracaoIA = new Date().toISOString();

writeFileSync(
    "./test/exemplos/resultado_simulado.json",
    JSON.stringify(jf, null, 2),
    "utf-8",
);
console.log("\n✓ JSON salvo em test/exemplos/resultado_simulado.json");
