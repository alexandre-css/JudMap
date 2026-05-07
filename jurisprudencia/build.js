#!/usr/bin/env node
/**
 * jurisprudencia/build.js
 *
 * Reestrutura os JSONs de súmulas e temas para o schema do JudMap e
 * gera arquivos Markdown limpos para cada corpus.
 *
 * Saída:
 *   jurisprudencia/sumulas/sumulas_stf.json  — array plano, schema limpo
 *   jurisprudencia/sumulas/sumulas_stj.json  — idem + 7 súmulas ECA fundidas
 *   jurisprudencia/temas/temas_stf.json      — array plano, schema limpo
 *   jurisprudencia/temas/temas_stj.json      — idem
 *   jurisprudencia/md/sumulas_stf.md
 *   jurisprudencia/md/sumulas_stj.md
 *   jurisprudencia/md/temas_stf.md
 *   jurisprudencia/md/temas_stj.md
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function ler(rel) {
    return JSON.parse(readFileSync(resolve(ROOT, rel), "utf-8"));
}

function escrever(rel, dados) {
    writeFileSync(
        resolve(ROOT, rel),
        JSON.stringify(dados, null, 2) + "\n",
        "utf-8",
    );
    console.log(
        `[build] Escrito: jurisprudencia/${rel}  (${dados.length} itens)`,
    );
}

function escreverMd(rel, conteudo) {
    writeFileSync(resolve(ROOT, rel), conteudo, "utf-8");
    console.log(`[build] Escrito: jurisprudencia/${rel}`);
}

// ---------------------------------------------------------------------------
// Leitura dos dados atuais
// ---------------------------------------------------------------------------

const rawSTF = ler("sumulas/sumulas_stf.json");
const rawSTJ = ler("sumulas/sumulas_stj.json");
const rawTSTF = ler("temas/temas_stf.json");
const rawTSTJ = ler("temas/temas_stj.json");

// Detectar se os JSONs já estão no schema novo (array) ou legado (objeto com .sumulas/.temas)
// Isso torna o build idempotente — pode rodar múltiplas vezes sem problema.

// ---------------------------------------------------------------------------
// Transformação: Súmulas
// ---------------------------------------------------------------------------

/**
 * Transforma uma súmula do schema antigo para o novo.
 *
 * Schema novo:
 *   numero         number
 *   tribunal       "STF" | "STJ"
 *   texto          string
 *   vinculante     boolean
 *   superadaEmParte boolean
 *   alterada       boolean
 *   area           string | null   ("ECA" ou null)
 */
function transformarSumula(s, tribunal, area = null) {
    return {
        numero: s.numero,
        tribunal,
        texto: s.texto.trim(),
        vinculante: s.vinculante ?? false,
        superadaEmParte: (s.chips ?? []).includes("SUPERADA EM PARTE"),
        alterada: (s.chips ?? []).includes("ALTERADA"),
        area,
    };
}

// Se já está no schema novo (array plano), re-serializa direto; senão, transforma do legado.
// Isso torna o build idempotente — pode rodar múltiplas vezes sem problema.

function normalizarSumulas(raw, tribunal) {
    if (Array.isArray(raw)) {
        // Schema novo: apenas garantir ordenação
        return raw.sort((a, b) => a.numero - b.numero);
    }
    // Schema legado: transformar
    return raw.sumulas
        .map((s) => transformarSumula(s, tribunal))
        .sort((a, b) => a.numero - b.numero);
}

function normalizarTemas(raw, tribunal) {
    if (Array.isArray(raw)) {
        return raw.sort((a, b) => a.numero - b.numero);
    }
    return raw.temas
        .map((t) => transformarTema(t, tribunal))
        .sort((a, b) => a.numero - b.numero);
}

const sumulasSTF = normalizarSumulas(rawSTF, "STF");
const sumulasSTJ = normalizarSumulas(rawSTJ, "STJ");

// ---------------------------------------------------------------------------
// Transformação: Temas
// ---------------------------------------------------------------------------

/**
 * Transforma um tema do schema antigo para o novo.
 *
 * Schema novo:
 *   numero           number
 *   tribunal         "STF" | "STJ"
 *   titulo           string
 *   tese             string
 *   observacao       string | null
 *   modulacaoEfeitos string | null
 */
function transformarTema(t, tribunal) {
    return {
        numero: t.numero,
        tribunal,
        titulo: (t.titulo ?? "").trim(),
        tese: (t.tese ?? "").trim(),
        observacao: t.comentario?.trim() || null,
        modulacaoEfeitos: t.modulacao_efeitos?.trim() || null,
    };
}

const temasSTF = normalizarTemas(rawTSTF, "STF");
const temasSTJ = normalizarTemas(rawTSTJ, "STJ");

// ---------------------------------------------------------------------------
// Geração de Markdown
// ---------------------------------------------------------------------------

function mdSumulas(sumulas, titulo) {
    const linhas = [`# ${titulo}`, ""];
    for (const s of sumulas) {
        // Heading: SV não leva tribunal (só existe no STF); demais levam /{tribunal}
        if (s.vinculante) {
            linhas.push(`## Súmula Vinculante ${s.numero}`);
        } else {
            linhas.push(`## Súmula ${s.numero}/${s.tribunal}`);
        }

        // Flags não-oficiais como blockquote
        const flags = [];
        if (s.superadaEmParte) flags.push("SUPERADA EM PARTE");
        if (s.alterada) flags.push("ALTERADA");
        if (s.area) flags.push(s.area);
        if (flags.length) linhas.push(`> ${flags.join(" · ")}`);

        linhas.push("");
        linhas.push(s.texto);
        linhas.push("");
        linhas.push("---");
        linhas.push("");
    }
    return linhas.join("\n");
}

function mdTemas(temas, titulo) {
    const linhas = [`# ${titulo}`, ""];
    for (const t of temas) {
        // Heading: apenas número e tribunal — título é informal
        linhas.push(`## Tema ${t.numero}/${t.tribunal}`);

        // Título como nota italic — claramente não-oficial
        if (t.titulo) linhas.push(`*${t.titulo}*`);

        linhas.push("");
        linhas.push(t.tese);
        linhas.push("");
        if (t.observacao) {
            linhas.push(`> **Obs.:** ${t.observacao}`);
            linhas.push("");
        }
        if (t.modulacaoEfeitos) {
            linhas.push(`> **Modulação de efeitos:** ${t.modulacaoEfeitos}`);
            linhas.push("");
        }
        linhas.push("---");
        linhas.push("");
    }
    return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

mkdirSync(resolve(ROOT, "md"), { recursive: true });

escrever("sumulas/sumulas_stf.json", sumulasSTF);
escrever("sumulas/sumulas_stj.json", sumulasSTJ);
escrever("temas/temas_stf.json", temasSTF);
escrever("temas/temas_stj.json", temasSTJ);

escreverMd("md/sumulas_stf.md", mdSumulas(sumulasSTF, "Súmulas Criminais STF"));
escreverMd("md/sumulas_stj.md", mdSumulas(sumulasSTJ, "Súmulas Criminais STJ"));
escreverMd(
    "md/temas_stf.md",
    mdTemas(temasSTF, "Temas de Repercussão Geral STF (Criminal)"),
);
escreverMd(
    "md/temas_stj.md",
    mdTemas(temasSTJ, "Temas Repetitivos STJ (Criminal)"),
);

console.log("\n[build] Concluído.");
console.log(`  Súmulas STF: ${sumulasSTF.length}`);
console.log(
    `  Súmulas STJ: ${sumulasSTJ.length} (inclui ${sumulasSTJ.filter((s) => s.area === "ECA").length} súmulas ECA)`,
);
console.log(`  Temas STF: ${temasSTF.length}`);
console.log(`  Temas STJ: ${temasSTJ.length}`);
