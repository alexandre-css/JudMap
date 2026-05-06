import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

const SCHEMA = JSON.parse(
    readFileSync(join(ROOT, "sentenca_schema.json"), "utf-8"),
);
const ENUM = JSON.parse(readFileSync(join(ROOT, "enum.json"), "utf-8"));

// Schema limpo para o prompt: remove _nota_ e campos que a IA não deve preencher
const CAMPOS_NAO_IA = new Set([
    "totalDias",
    "tokensConsumidos",
    "ultimaExtracaoIA",
    "pppAbstrataDataLimite",
    "pppAbstrataConfigurada",
    "pppRetroativaDataLimite",
    "pppIntercorrenteDataLimite",
    "ppeDataLimite",
    "sumulaViolada",
]);

function limparEnumParaPrompt(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("_")) continue;
        out[k] = limparEnumParaPrompt(v);
    }
    return out;
}

function limparSchemaParaPrompt(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(limparSchemaParaPrompt);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (CAMPOS_NAO_IA.has(k)) {
            out[k] = "__calculado_pelo_sistema__";
        } else {
            out[k] = limparSchemaParaPrompt(v);
        }
    }
    return out;
}

const SCHEMA_PROMPT = JSON.stringify(limparSchemaParaPrompt(SCHEMA), null, 2);
const ENUM_PROMPT = JSON.stringify(limparEnumParaPrompt(ENUM), null, 2);

const SYSTEM_TEXT = `Você é um extrator especializado em análise de sentenças judiciais penais brasileiras.

Sua única tarefa: analisar o texto jurídico fornecido e preencher o schema JSON abaixo com as informações encontradas.

REGRAS OBRIGATÓRIAS:
1. Campos não encontrados no texto: SEMPRE null. Nunca "", 0, "N/A" ou "não informado".
2. Campos categóricos: usar EXCLUSIVAMENTE os valores do DICIONÁRIO DE ENUMS. Sem variações.
3. Datas: formato DD/MM/AAAA.
4. Penas: preencher anos, meses e dias como inteiros separados. NÃO calcular totalDias.
5. Campos marcados __calculado_pelo_sistema__: deixar null, nunca preencher.
6. Trechos de fundamento (campo "fundamento"): copiar literal da sentença, 80-250 caracteres. Nunca parafrasear.
7. Confiança (metadados.confianca): seu próprio float 0.0-1.0 para a qualidade geral da extração.
8. Réus: criar um objeto por réu identificado. Crimes condenado: um objeto por crime.
9. Retornar APENAS o JSON preenchido, sem explicações, sem markdown, sem \`\`\`json.

ANOTAÇÕES IMPORTANTES DO DICIONÁRIO:
- antecedentes: distinguir primario_com_antecedentes (condenação sem reincidência, >5 anos) de reincidente. Processos em curso NÃO são antecedentes (Súmula 444 STJ).
- compensacaoIntegral: true quando confissão compensa reincidência na fase 2.
- recorrente: para réus específicos, usar "reu:Nome Completo".
- teses dos recursos: usar valores padronizados do enum quando possível; complementar com texto livre quando necessário.
- dataFato: a data do crime geralmente aparece na DENÚNCIA TRANSCRITA pelo juiz no início da sentença (relatório), em frases como "No dia DD de MMMM de AAAA, por volta das HHhMMmin..." ou "em data de DD/MM/AAAA, na cidade de...". SEMPRE procurar essa data no início do documento, não apenas no dispositivo. NÃO confundir com data de oferecimento da denúncia, data da prisão em flagrante, ou data da sentença.
- vitimas: estruturar cada vítima com nome (ou apelido/iniciais preservando sigilo), vulnerabilidade (crianca, idoso, mulher_violencia_domestica, coletividade etc.) e relacaoComReu (conjuge_companheiro, agente_publico, desconhecido etc.). Quando o crime não tem vítima individualizada (tráfico, ambiental), usar nome "A Coletividade" com vulnerabilidade "coletividade".
- bensApreendidos: listar todo bem citado no dispositivo da sentença com destinação. Armas/munições → encaminhamento_exercito (Resolução GP/CGJ 9); drogas → incineracao; celulares/dinheiro/veículos → indicar destinação fixada pelo juiz. ehInstrumentoCrime: true para armas, drogas, veículos usados no crime.
- substituicaoPRD.especiesAplicadas: para cada espécie, preencher horasTotal (PSC), valorTotal (prestação pecuniária), beneficiario (vitima_direta, entidade_assistencial etc.) e fundamentoArt quando citado ("art. 44, §2º, CP").
- sursisPenal.condicoes e condicoesRegimeAberto: copiar literais do dispositivo ("comparecer mensalmente em juízo", "não se ausentar da comarca por mais de 8 dias sem autorização judicial", "não frequentar lugares de duvidosa reputação"). Um item por condição.
- statusLiberdadeRecursal: extrair do dispositivo final. "concedo o direito de recorrer em liberdade" → concedidoLiberdade: true; "mantenho a prisão preventiva" → manidaPrisaoPreventiva: true; "imponho cautelar diversa" → impostoCautelarDiversa: true. Preencher fundamento quando o juiz explicitar (ex: garantia da ordem pública).

SCHEMA DE SAÍDA (preencher):
${SCHEMA_PROMPT}

DICIONÁRIO DE ENUMS (valores permitidos para campos categóricos):
${ENUM_PROMPT}`;

// Trunca texto longo preservando início (cabeçalho) e fim (dispositivo/parte decisória)
function truncarTexto(texto, maxChars = 60_000) {
    if (texto.length <= maxChars) return texto;
    const metade = Math.floor(maxChars / 2);
    const inicio = texto.slice(0, metade);
    const fim = texto.slice(-metade);
    return `${inicio}\n\n[...TEXTO TRUNCADO — ${texto.length - maxChars} CARACTERES OMITIDOS...]\n\n${fim}`;
}

/**
 * Retorna { systemText, userText } prontos para enviar à IA.
 * @param {string} textoSentenca  - Texto extraído da sentença/acórdão
 * @param {'grau1'|'grau2'|'completo'} grau - Contexto de extração
 */
export function buildPrompt(textoSentenca, grau = "grau1") {
    const instrucaoGrau =
        grau === "grau2"
            ? "Foco: preencher campos de grau2 (recursos, parecerPGJ, acórdão). Preservar dados de grau1 que já existam."
            : grau === "completo"
              ? "Preencher todos os campos disponíveis (grau1 e grau2)."
              : "Foco: preencher campos de grau1 (sentença de primeiro grau). Deixar grau2 com null.";

    const userText = `${instrucaoGrau}

TEXTO DO DOCUMENTO JUDICIAL:
${truncarTexto(textoSentenca)}`;

    return { systemText: SYSTEM_TEXT, userText };
}

export { SCHEMA, ENUM };
